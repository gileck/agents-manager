import type Database from 'better-sqlite3';
import type {
  Task,
  Subtask,
  ImplementationPhase,
  PlanComment,
  Transition,
  TransitionTrigger,
  TransitionContext,
  TransitionResult,
  GuardFn,
  GuardResult,
  HookFn,
  HookFailure,
  HookExecutionPolicy,
  AllTransitionsResult,
  GuardCheckResult,
  HookRetryResult,
  TransitionWithGuards,
  TransitionHook,
  PostProcessingLogCategory,
} from '../../shared/types';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import { generateId, now, parseJson } from '../stores/utils';
import { getAppLogger } from './app-logger';

type OnPostLog = (category: PostProcessingLogCategory, message: string, details?: Record<string, unknown>, durationMs?: number) => void;

interface TaskRow {
  id: string;
  project_id: string;
  pipeline_id: string;
  title: string;
  description: string | null;
  type: string;
  size: string | null;
  complexity: string | null;
  status: string;
  priority: number;
  tags: string;
  parent_task_id: string | null;
  assignee: string | null;
  pr_link: string | null;
  branch_name: string | null;
  feature_id: string | null;
  plan: string | null;
  technical_design: string | null;
  debug_info: string | null;
  subtasks: string;
  phases: string | null;
  plan_comments: string;
  technical_design_comments: string;
  metadata: string;
  created_at: number;
  updated_at: number;
  created_by: string | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    pipelineId: row.pipeline_id,
    title: row.title,
    description: row.description,
    type: (row.type || 'feature') as Task['type'],
    size: (row.size ?? null) as Task['size'],
    complexity: (row.complexity ?? null) as Task['complexity'],
    status: row.status,
    priority: row.priority,
    tags: parseJson<string[]>(row.tags, []),
    parentTaskId: row.parent_task_id,
    featureId: row.feature_id,
    assignee: row.assignee,
    prLink: row.pr_link,
    branchName: row.branch_name,
    plan: row.plan,
    technicalDesign: row.technical_design,
    debugInfo: row.debug_info,
    subtasks: parseJson<Subtask[]>(row.subtasks, []),
    phases: row.phases ? parseJson<ImplementationPhase[] | null>(row.phases, null) : null,
    planComments: parseJson<PlanComment[]>(row.plan_comments, []),
    technicalDesignComments: parseJson<PlanComment[]>(row.technical_design_comments, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: (row.created_by as Task['createdBy']) ?? null,
  };
}

export class PipelineEngine implements IPipelineEngine {
  private guards = new Map<string, GuardFn>();
  private hooks = new Map<string, HookFn>();

  constructor(
    private pipelineStore: IPipelineStore,
    private taskStore: ITaskStore,
    private taskEventLog: ITaskEventLog,
    private db: Database.Database,
  ) {}

  registerGuard(name: string, fn: GuardFn): void {
    this.guards.set(name, fn);
  }

  registerHook(name: string, fn: HookFn): void {
    this.hooks.set(name, fn);
  }

  async getValidTransitions(task: Task, trigger?: TransitionTrigger): Promise<Transition[]> {
    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return [];

    return pipeline.transitions.filter((t) => {
      if (t.from !== task.status && t.from !== '*') return false;
      if (trigger && t.trigger !== trigger) return false;
      return true;
    });
  }

  async executeTransition(task: Task, toStatus: string, context?: TransitionContext, onPostLog?: OnPostLog): Promise<TransitionResult> {
    const ctx: TransitionContext = context ?? { trigger: 'manual' };

    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) {
      return { success: false, error: `Pipeline not found: ${task.pipelineId}` };
    }

    // Find ALL matching transitions — enforce trigger type match and agentOutcome.
    // Multiple transitions may share the same from/to/trigger with different guards;
    // we iterate them in order and fall through to the next on guard failure.
    const fromMatch = (t: Transition) => t.from === task.status || t.from === '*';
    const outcomeMatch = (t: Transition) => {
      // When the context carries an agent outcome, only match transitions with a matching
      // agentOutcome. This prevents matching the wrong self-loop transition
      // (e.g. the 'failed' transition instead of 'conflicts_detected') when multiple
      // transitions share the same from/to/trigger combination.
      if (ctx.trigger === 'agent' && ctx.data?.outcome) {
        return t.agentOutcome === ctx.data.outcome;
      }
      return true;
    };
    const candidateTransitions = pipeline.transitions.filter(
      (t) => fromMatch(t) && t.to === toStatus && t.trigger === ctx.trigger && outcomeMatch(t),
    );
    if (candidateTransitions.length === 0) {
      return {
        success: false,
        error: `No transition from "${task.status}" to "${toStatus}" in pipeline "${pipeline.name}"`,
      };
    }

    // Try each matching transition in order, falling through on guard failures.
    let lastGuardFailures: Array<{ guard: string; reason: string }> = [];

    for (const transition of candidateTransitions) {
    // Execute atomically within a sync transaction (better-sqlite3 requirement).
    // Uses raw SQL inside the transaction — the async store interface can't be
    // called from a synchronous callback.
    let updatedTask: Task | null = null;
    const guardResults: Record<string, GuardResult> = {};
    const guardFailures: Array<{ guard: string; reason: string }> = [];

    const txn = this.db.transaction(() => {
      // Re-fetch task inside transaction via raw SQL (TOCTOU protection)
      const freshRow = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as TaskRow | undefined;
      if (!freshRow) {
        throw new Error(`Task not found: ${task.id}`);
      }
      if (freshRow.status !== task.status) {
        throw new Error(`Task status changed: expected "${task.status}", got "${freshRow.status}"`);
      }
      const freshTask = rowToTask(freshRow);

      // Run guards synchronously
      if (transition.guards) {
        for (const guard of transition.guards) {
          const guardFn = this.guards.get(guard.name);
          if (!guardFn) {
            const result: GuardResult = { allowed: false, reason: `Guard "${guard.name}" not registered` };
            guardResults[guard.name] = result;
            guardFailures.push({ guard: guard.name, reason: result.reason! });
            continue;
          }
          const result = guardFn(freshTask, transition, ctx, this.db, guard.params);
          guardResults[guard.name] = result;
          if (!result.allowed) {
            guardFailures.push({ guard: guard.name, reason: result.reason ?? 'Guard check failed' });
          }
        }
        // Note: onPostLog is called outside the sync transaction below
      }

      if (guardFailures.length > 0) {
        // Record the denied attempt so it's visible in the audit trail
        this.db.prepare(`
          INSERT INTO transition_history (id, task_id, from_status, to_status, trigger, actor, guard_results, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId(),
          task.id,
          task.status,
          toStatus,
          ctx.trigger,
          ctx.actor ?? null,
          JSON.stringify({ _denied: true, guardFailures }),
          now(),
        );
        return;
      }

      updatedTask = this.applyStatusUpdate(freshTask, task.id, task.status, toStatus, ctx, guardResults);
    });

    try {
      txn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }

    if (guardFailures.length > 0) {
      onPostLog?.('pipeline', `Guards blocked transition ${task.status} → ${toStatus}: ${guardFailures.map(g => `${g.guard}: ${g.reason}`).join(', ')}`, {
        from: task.status, to: toStatus, guardFailures,
      });
      lastGuardFailures = guardFailures;
      // Continue to the next candidate transition
      continue;
    }

    if (!updatedTask) {
      return { success: false, error: 'Transaction completed but task was not updated' };
    }

    onPostLog?.('pipeline', `Guards passed for ${task.status} → ${toStatus}, executing hooks`, {
      from: task.status, to: toStatus, hookCount: transition.hooks?.length ?? 0,
    });

    // Run hooks after transaction
    const hookFailures = await this.executeHooks(transition.hooks, updatedTask, transition, ctx, task.id, undefined, onPostLog);

    // If any required hook failed, roll back the status change transactionally
    const requiredFailures = hookFailures.filter(f => f.policy === 'required');
    if (requiredFailures.length > 0) {
      this.rollbackStatusChange(task.id, task.status, toStatus, ctx, requiredFailures);
      await this.taskEventLog.log({
        taskId: task.id,
        category: 'system',
        severity: 'error',
        message: `Transition ${task.status} → ${toStatus} rolled back: required hook(s) failed`,
        data: { failures: requiredFailures.map(f => ({ hook: f.hook, error: f.error })) },
      });
      // After rollback, check if the failed hook requested a follow-up transition
      const followUp = requiredFailures.find(f => f.followUpTransition)?.followUpTransition;
      if (followUp) {
        const freshRow = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as TaskRow | undefined;
        if (!freshRow) {
          getAppLogger().error('PipelineEngine', `Follow-up transition skipped: task ${task.id} not found after rollback`);
        } else {
          this.taskEventLog.log({
            taskId: task.id,
            category: 'system',
            severity: 'info',
            message: `Dispatching follow-up transition to "${followUp.to}" after rollback`,
            data: { followUpTo: followUp.to, followUpTrigger: followUp.trigger },
          }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));

          this.executeTransition(rowToTask(freshRow), followUp.to, { trigger: followUp.trigger, actor: ctx.actor })
            .catch(err => {
              const msg = err instanceof Error ? err.message : String(err);
              this.taskEventLog.log({
                taskId: task.id,
                category: 'system',
                severity: 'error',
                message: `Follow-up transition to "${followUp.to}" failed: ${msg}`,
                data: { followUpTo: followUp.to, followUpTrigger: followUp.trigger, error: msg },
              }).catch((logErr) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', logErr));
            });
        }
      }

      return {
        success: false,
        error: requiredFailures.map(f => `${f.hook}: ${f.error}`).join('; '),
        hookFailures,
      };
    }

    // Log status_change event
    await this.taskEventLog.log({
      taskId: task.id,
      category: 'status_change',
      severity: 'info',
      message: `Status changed from "${task.status}" to "${toStatus}"`,
      data: {
        fromStatus: task.status,
        toStatus,
        trigger: ctx.trigger,
        actor: ctx.actor,
      },
    });

    return { success: true, task: updatedTask, ...(hookFailures.length > 0 ? { hookFailures } : {}) };
    } // end for (transition of candidateTransitions)

    // All candidate transitions were blocked by guards — log and return failure
    this.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      severity: 'warning',
      message: `Transition ${task.status} → ${toStatus} blocked by guards: ${lastGuardFailures.map(g => `${g.guard}: ${g.reason}`).join('; ')}`,
      data: { fromStatus: task.status, toStatus, trigger: ctx.trigger, guardFailures: lastGuardFailures },
    }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
    return { success: false, guardFailures: lastGuardFailures };
  }

  async getAllTransitions(task: Task): Promise<AllTransitionsResult> {
    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return { manual: [], agent: [], system: [] };

    const matching = pipeline.transitions.filter(
      (t) => t.from === task.status || t.from === '*',
    );

    const result: AllTransitionsResult = { manual: [], agent: [], system: [] };
    for (const t of matching) {
      const tw: TransitionWithGuards = { ...t };
      result[t.trigger].push(tw);
    }
    return result;
  }

  /**
   * Force-transition a task to a target status, bypassing all guards.
   *
   * Unlike {@link executeTransition}, this method:
   * - Skips guard evaluation entirely (the transition is always allowed).
   * - Still runs hooks when a matching transition definition exists, but
   *   treats required-hook failures as **non-fatal** — the status change is
   *   NOT rolled back. This is intentional: force transitions are an
   *   administrative override, so hook failures are logged but do not block
   *   the operation.
   */
  async executeForceTransition(task: Task, toStatus: string, context?: TransitionContext): Promise<TransitionResult> {
    const ctx: TransitionContext = context ?? { trigger: 'manual' };

    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) {
      return { success: false, error: `Pipeline not found: ${task.pipelineId}` };
    }

    // Verify the target status exists in the pipeline
    const targetStatus = pipeline.statuses.find((s) => s.name === toStatus);
    if (!targetStatus) {
      return { success: false, error: `Status "${toStatus}" not found in pipeline "${pipeline.name}"` };
    }

    // Find a matching transition (for hooks), but don't require one
    const fromMatch = (t: Transition) => t.from === task.status || t.from === '*';
    const transition = pipeline.transitions.find(
      (t) => fromMatch(t) && t.to === toStatus,
    );

    let updatedTask: Task | null = null;

    const txn = this.db.transaction(() => {
      const freshRow = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as TaskRow | undefined;
      if (!freshRow) {
        throw new Error(`Task not found: ${task.id}`);
      }
      if (freshRow.status !== task.status) {
        throw new Error(`Task status changed: expected "${task.status}", got "${freshRow.status}"`);
      }
      const freshTask = rowToTask(freshRow);

      // Skip guards — this is a force transition
      updatedTask = this.applyStatusUpdate(freshTask, task.id, task.status, toStatus, ctx, { _forced: true });
    });

    try {
      txn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }

    if (!updatedTask) {
      return { success: false, error: 'Transaction completed but task was not updated' };
    }

    // Still run hooks if a transition was found
    const hookFailures = transition
      ? await this.executeHooks(transition.hooks, updatedTask, transition, ctx, task.id, true)
      : [];

    await this.taskEventLog.log({
      taskId: task.id,
      category: 'status_change',
      severity: 'info',
      message: `Force-transitioned from "${task.status}" to "${toStatus}"`,
      data: {
        fromStatus: task.status,
        toStatus,
        trigger: ctx.trigger,
        actor: ctx.actor,
        forced: true,
      },
    });

    return { success: true, task: updatedTask, ...(hookFailures.length > 0 ? { hookFailures } : {}) };
  }

  async checkGuards(task: Task, toStatus: string, trigger: TransitionTrigger, outcome?: string): Promise<GuardCheckResult | null> {
    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return null;

    const fromMatch = (t: Transition) => t.from === task.status || t.from === '*';
    const transition = pipeline.transitions.find(
      (t) => fromMatch(t) && t.to === toStatus && t.trigger === trigger
        && (!outcome || t.agentOutcome === outcome),
    );
    if (!transition) return null;

    const results: Array<{ guard: string; allowed: boolean; reason?: string }> = [];
    let canTransition = true;

    if (transition.guards) {
      for (const guard of transition.guards) {
        const guardFn = this.guards.get(guard.name);
        if (!guardFn) {
          results.push({ guard: guard.name, allowed: false, reason: `Guard "${guard.name}" not registered` });
          canTransition = false;
          continue;
        }
        const result = guardFn(task, transition, { trigger }, this.db, guard.params);
        results.push({ guard: guard.name, allowed: result.allowed, reason: result.reason });
        if (!result.allowed) canTransition = false;
      }
    }

    return { canTransition, results };
  }

  async retryHook(task: Task, hookName: string, transition: Transition, context?: TransitionContext): Promise<HookRetryResult> {
    const hookFn = this.hooks.get(hookName);
    if (!hookFn) {
      return { success: false, hookName, error: `Hook "${hookName}" not registered` };
    }

    const ctx: TransitionContext = context ?? { trigger: 'manual' };
    const hookDef = transition.hooks?.find((h) => h.name === hookName);
    const retryEventBase = {
      hookName,
      transition: { from: transition.from, to: transition.to },
      params: hookDef?.params,
    };

    // Log retry started
    await this.taskEventLog.log({
      taskId: task.id,
      category: 'hook_execution',
      severity: 'info',
      message: `Hook retry "${hookName}" starting`,
      data: { ...retryEventBase, result: 'retry_started' },
    });

    try {
      const result = await hookFn(task, transition, ctx, hookDef?.params);
      if (result && !result.success) {
        await this.taskEventLog.log({
          taskId: task.id,
          category: 'hook_execution',
          severity: 'warning',
          message: `Hook retry "${hookName}" failed: ${result.error ?? 'unknown'}`,
          data: { ...retryEventBase, result: 'retry_failure', error: result.error },
        });
        return { success: false, hookName, error: result.error ?? 'Hook returned failure' };
      }

      await this.taskEventLog.log({
        taskId: task.id,
        category: 'hook_execution',
        severity: 'info',
        message: `Hook retry "${hookName}" succeeded`,
        data: { ...retryEventBase, result: 'retry_success' },
      });
      return { success: true, hookName };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.taskEventLog.log({
        taskId: task.id,
        category: 'hook_execution',
        severity: 'error',
        message: `Hook retry "${hookName}" threw: ${message}`,
        data: { ...retryEventBase, result: 'retry_failure', error: message },
      });
      return { success: false, hookName, error: message };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Apply status update and insert transition history within an active transaction.
   * Must be called inside a db.transaction() callback.
   */
  private applyStatusUpdate(
    freshTask: Task,
    taskId: string,
    fromStatus: string,
    toStatus: string,
    ctx: TransitionContext,
    guardResults: Record<string, unknown>,
  ): Task {
    const timestamp = now();
    this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(toStatus, timestamp, taskId);

    this.db.prepare(`
      INSERT INTO transition_history (id, task_id, from_status, to_status, trigger, actor, guard_results, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(),
      taskId,
      fromStatus,
      toStatus,
      ctx.trigger,
      ctx.actor ?? null,
      JSON.stringify(guardResults),
      timestamp,
    );

    return { ...freshTask, status: toStatus, updatedAt: timestamp };
  }

  /**
   * Execute hooks for a transition. Returns array of hook failures.
   * Handles all three policies: fire_and_forget, required, and best_effort.
   */
  private async executeHooks(
    hookDefs: TransitionHook[] | undefined,
    updatedTask: Task,
    transition: Transition,
    ctx: TransitionContext,
    taskId: string,
    forced?: boolean,
    onPostLog?: OnPostLog,
  ): Promise<HookFailure[]> {
    const hookFailures: HookFailure[] = [];
    if (!hookDefs) return hookFailures;

    for (const hook of hookDefs) {
      const hookFn = this.hooks.get(hook.name);
      const policy: HookExecutionPolicy = hook.policy ?? 'best_effort';

      const hookEventBase = {
        hookName: hook.name,
        transition: { from: transition.from, to: transition.to },
        params: hook.params,
        policy,
        ...(forced ? { forced: true } : {}),
      };

      if (!hookFn) {
        if (forced) {
          await this.taskEventLog.log({
            taskId,
            category: 'system',
            severity: 'warning',
            message: `Hook "${hook.name}" not registered (skipped during force transition)`,
            data: { hookName: hook.name, forced: true },
          });
        } else {
          const failure: HookFailure = { hook: hook.name, error: `Hook "${hook.name}" not registered`, policy };
          hookFailures.push(failure);
          this.taskEventLog.log({
            taskId,
            category: 'system',
            severity: 'warning',
            message: `Hook "${hook.name}" not registered — skipping`,
            data: { hookName: hook.name },
          }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
        }
        continue;
      }

      if (policy === 'fire_and_forget') {
        // Log started event
        onPostLog?.('pipeline', `Hook "${hook.name}" started (fire_and_forget)`, { hookName: hook.name, policy });
        this.taskEventLog.log({
          taskId,
          category: 'hook_execution',
          severity: 'info',
          message: `Hook "${hook.name}" starting (fire_and_forget)`,
          data: { ...hookEventBase, result: 'started' },
        }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));

        const ffStart = performance.now();
        hookFn(updatedTask, transition, ctx, hook.params).then(() => {
          const ffDuration = Math.round(performance.now() - ffStart);
          onPostLog?.('pipeline', `Hook "${hook.name}" completed (fire_and_forget)`, { hookName: hook.name, policy }, ffDuration);
          // Log hook_execution event for fire_and_forget success
          this.taskEventLog.log({
            taskId,
            category: 'hook_execution',
            severity: 'info',
            message: `Hook "${hook.name}" succeeded (fire_and_forget)`,
            data: { ...hookEventBase, result: 'success' },
          }).catch((logErr) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', logErr));
        }).catch((err) => {
          const ffDuration = Math.round(performance.now() - ffStart);
          const message = err instanceof Error ? err.message : String(err);
          onPostLog?.('pipeline', `Hook "${hook.name}" failed (fire_and_forget): ${message}`, { hookName: hook.name, policy, error: message }, ffDuration);
          this.taskEventLog.log({
            taskId,
            category: 'system',
            severity: 'error',
            message: `Hook "${hook.name}" failed (fire_and_forget${forced ? ', forced' : ''}): ${message}`,
            data: { hookName: hook.name, error: message, ...(forced ? { forced: true } : {}) },
          }).catch((logErr) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', logErr));
          // Log hook_execution event for fire_and_forget failure
          this.taskEventLog.log({
            taskId,
            category: 'hook_execution',
            severity: 'error',
            message: `Hook "${hook.name}" failed (fire_and_forget): ${message}`,
            data: { ...hookEventBase, result: 'failure', error: message },
          }).catch((logErr) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', logErr));
        });
        continue;
      }

      // required or best_effort: await the hook
      // Log started event
      onPostLog?.('pipeline', `Hook "${hook.name}" starting (${policy})`, { hookName: hook.name, policy });
      await this.taskEventLog.log({
        taskId,
        category: 'hook_execution',
        severity: 'info',
        message: `Hook "${hook.name}" starting (${policy})`,
        data: { ...hookEventBase, result: 'started' },
      });
      const hookStart = Date.now();
      try {
        const result = await hookFn(updatedTask, transition, ctx, hook.params);
        const duration = Date.now() - hookStart;
        if (result && !result.success) {
          const failure: HookFailure = { hook: hook.name, error: result.error ?? 'Hook returned failure', policy, followUpTransition: result.followUpTransition };
          hookFailures.push(failure);
          onPostLog?.('pipeline', `Hook "${hook.name}" failed (${policy}): ${failure.error}`, { hookName: hook.name, policy, error: failure.error }, duration);
          const severity = policy === 'required' ? 'error' as const : forced ? 'error' as const : 'warning' as const;
          this.taskEventLog.log({
            taskId,
            category: 'system',
            severity,
            message: `Hook "${hook.name}" failed${forced ? ' during force transition' : ''} (${policy}): ${failure.error}`,
            data: { hookName: hook.name, error: failure.error, policy, ...(forced ? { forced: true } : {}) },
          }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
          // Log hook_execution event for failure
          this.taskEventLog.log({
            taskId,
            category: 'hook_execution',
            severity,
            message: `Hook "${hook.name}" failed (${policy}): ${failure.error}`,
            data: { ...hookEventBase, result: 'failure', error: failure.error, duration },
          }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
        } else {
          onPostLog?.('pipeline', `Hook "${hook.name}" succeeded (${policy})`, { hookName: hook.name, policy }, duration);
          // Log system event for success
          this.taskEventLog.log({
            taskId,
            category: 'system',
            severity: 'info',
            message: `Hook "${hook.name}" succeeded (${policy})`,
            data: { hookName: hook.name, policy },
          }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
          // Log hook_execution event for success
          this.taskEventLog.log({
            taskId,
            category: 'hook_execution',
            severity: 'info',
            message: `Hook "${hook.name}" succeeded (${policy})`,
            data: { ...hookEventBase, result: 'success', duration },
          }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
        }
      } catch (err) {
        const duration = Date.now() - hookStart;
        const message = err instanceof Error ? err.message : String(err);
        const failure: HookFailure = { hook: hook.name, error: message, policy };
        hookFailures.push(failure);
        onPostLog?.('pipeline', `Hook "${hook.name}" threw (${policy}): ${message}`, { hookName: hook.name, policy, error: message }, duration);
        const severity = policy === 'required' ? 'error' as const : forced ? 'error' as const : 'warning' as const;
        this.taskEventLog.log({
          taskId,
          category: 'system',
          severity,
          message: `Hook "${hook.name}" threw${forced ? ' during force transition' : ''} (${policy}): ${message}`,
          data: { hookName: hook.name, error: message, policy, ...(forced ? { forced: true } : {}) },
        }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
        // Log hook_execution event for thrown error
        this.taskEventLog.log({
          taskId,
          category: 'hook_execution',
          severity,
          message: `Hook "${hook.name}" threw (${policy}): ${message}`,
          data: { ...hookEventBase, result: 'failure', error: message, duration },
        }).catch((logErr) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', logErr));
      }
    }

    return hookFailures;
  }

  /**
   * Roll back a status change transactionally after a required hook failure.
   * Inserts a compensating transition_history record with _rollback: true.
   */
  private rollbackStatusChange(
    taskId: string,
    originalStatus: string,
    failedToStatus: string,
    ctx: TransitionContext,
    requiredFailures: HookFailure[],
  ): void {
    try {
      const rollbackTxn = this.db.transaction(() => {
        const rollbackTimestamp = now();
        this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
          .run(originalStatus, rollbackTimestamp, taskId);
        this.db.prepare(`
          INSERT INTO transition_history (id, task_id, from_status, to_status, trigger, actor, guard_results, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateId(),
          taskId,
          failedToStatus,
          originalStatus,
          ctx.trigger,
          ctx.actor ?? null,
          JSON.stringify({ _rollback: true, failures: requiredFailures.map(f => ({ hook: f.hook, error: f.error })) }),
          rollbackTimestamp,
        );
      });
      rollbackTxn();
    } catch (rollbackErr) {
      const rollbackMsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      // Critical: rollback itself failed — log but continue returning the failure
      this.taskEventLog.log({
        taskId,
        category: 'system',
        severity: 'error',
        message: `CRITICAL: Rollback failed for transition ${originalStatus} → ${failedToStatus}: ${rollbackMsg}`,
        data: { rollbackError: rollbackMsg, failures: requiredFailures.map(f => ({ hook: f.hook, error: f.error })) },
      }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
    }
  }
}
