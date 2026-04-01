import type {
  Task,
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
  IGuardQueryContext,
  TransitionsWithRecommendation,
} from '../../shared/types';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { ITransactionRunner } from '../interfaces/transaction-runner';
import { generateId, now } from '../stores/utils';
import { getAppLogger } from './app-logger';

type OnPostLog = (category: PostProcessingLogCategory, message: string, details?: Record<string, unknown>, durationMs?: number) => void;

export class PipelineEngine implements IPipelineEngine {
  private guards = new Map<string, GuardFn>();
  private hooks = new Map<string, HookFn>();
  /** In-memory lock to prevent concurrent transitions on the same task while hooks are running. */
  private transitionsInFlight = new Set<string>();

  constructor(
    private pipelineStore: IPipelineStore,
    private taskStore: ITaskStore,
    private taskEventLog: ITaskEventLog,
    private txRunner: ITransactionRunner,
    private guardContext: IGuardQueryContext,
  ) {}

  registerGuard(name: string, fn: GuardFn): void {
    this.guards.set(name, fn);
  }

  registerHook(name: string, fn: HookFn): void {
    this.hooks.set(name, fn);
  }

  getPreviousStatus(taskId: string): string | null {
    return this.pipelineStore.getLastFromStatusSync(taskId);
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

  async getTransitionsWithRecommendation(task: Task): Promise<TransitionsWithRecommendation> {
    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return { transitions: [], recommended: null, forward: [], backward: [], escape: [] };

    const manualTransitions = pipeline.transitions.filter(
      (t) => (t.from === task.status || t.from === '*') && t.trigger === 'manual',
    );

    // Build a map of status name → position for classification
    const positionMap = new Map<string, number>();
    for (const s of pipeline.statuses) {
      if (s.position !== undefined) {
        positionMap.set(s.name, s.position);
      }
    }

    const currentPosition = positionMap.get(task.status);
    const currentStatusDef = pipeline.statuses.find((s) => s.name === task.status);
    const currentCategory = currentStatusDef?.category;

    // Escape statuses: terminal category OR statuses without a position (e.g. backlog).
    // Using position-based detection avoids hardcoding pipeline-specific status names.
    const escapeStatusNames = new Set(
      pipeline.statuses
        .filter((s) => s.category === 'terminal' || s.position === undefined)
        .map((s) => s.name),
    );

    // Classify transitions
    const forward: Transition[] = [];
    const backward: Transition[] = [];
    const escape: Transition[] = [];

    for (const t of manualTransitions) {
      if (escapeStatusNames.has(t.to)) {
        escape.push(t);
      } else if (currentPosition !== undefined) {
        const targetPosition = positionMap.get(t.to);
        if (targetPosition !== undefined && targetPosition > currentPosition) {
          forward.push(t);
        } else {
          backward.push(t);
        }
      } else {
        // No position data — treat as forward
        forward.push(t);
      }
    }

    // Pick recommended transition
    let recommended: Transition | null = null;
    if (currentCategory === 'human_review' && forward.length > 0) {
      // For review statuses: recommend the forward transition with the lowest target position
      recommended = forward.reduce((best, t) => {
        const bestPos = positionMap.get(best.to) ?? Infinity;
        const tPos = positionMap.get(t.to) ?? Infinity;
        return tPos < bestPos ? t : best;
      });
    } else if (forward.length > 0) {
      // For all other categories: first forward transition in definition order
      recommended = forward[0];
    } else if (manualTransitions.length > 0) {
      // Fallback: first non-escape transition, or first transition overall
      const nonEscape = manualTransitions.filter((t) => !escapeStatusNames.has(t.to));
      recommended = nonEscape[0] ?? manualTransitions[0];
    }

    return { transitions: manualTransitions, recommended, forward, backward, escape };
  }

  async executeTransition(task: Task, toStatus: string, context?: TransitionContext, onPostLog?: OnPostLog): Promise<TransitionResult> {
    const ctx: TransitionContext = context ?? { trigger: 'manual' };
    // Generate a correlationId for this transition chain if not already provided
    if (!ctx.correlationId) {
      ctx.correlationId = generateId();
    }

    // Reject if a transition is already in flight for this task
    if (this.transitionsInFlight.has(task.id)) {
      return { success: false, error: 'Transition already in progress for this task' };
    }

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
    // ── Phase 1: Guard evaluation (synchronous transaction) ──────────
    // Only validates guards — does NOT persist the status change.
    let freshTask: Task | null = null;
    const guardResults: Record<string, GuardResult> = {};
    const guardFailures: Array<{ guard: string; reason: string }> = [];

    try {
      this.txRunner.runTransaction(() => {
        // Re-fetch task inside transaction via sync store method (TOCTOU protection)
        freshTask = this.taskStore.getTaskSync(task.id);
        if (!freshTask) {
          throw new Error(`Task not found: ${task.id}`);
        }
        if (freshTask.status !== task.status) {
          throw new Error(`Task status changed: expected "${task.status}", got "${freshTask.status}"`);
        }

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
            const result = guardFn(freshTask, transition, ctx, this.guardContext, guard.params);
            guardResults[guard.name] = result;
            if (!result.allowed) {
              guardFailures.push({ guard: guard.name, reason: result.reason ?? 'Guard check failed' });
            }
          }
          // Note: onPostLog is called outside the sync transaction below
        }

        if (guardFailures.length > 0) {
          // Record the denied attempt so it's visible in the audit trail
          this.pipelineStore.recordTransitionSync({
            id: generateId(),
            taskId: task.id,
            fromStatus: task.status,
            toStatus,
            trigger: ctx.trigger,
            actor: ctx.actor ?? null,
            guardResults: { _denied: true, guardFailures },
            createdAt: now(),
          });
          return;
        }

        // Guards passed — do NOT persist status here (crash-safe: status stays at original)
      });
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

    if (!freshTask) {
      return { success: false, error: 'Transaction completed but task was not found' };
    }

    // Non-null assertion safe: freshTask was verified above and assigned inside the synchronous transaction
    const validatedTask: Task = freshTask;

    onPostLog?.('pipeline', `Guards passed for ${task.status} → ${toStatus}, executing hooks`, {
      from: task.status, to: toStatus, hookCount: transition.hooks?.length ?? 0,
    });

    // ── Phase 2: Required hook execution (async, no DB mutation) ─────
    // Construct a projected task with the target status (not persisted).
    // Run only required hooks. If any fail, return failure — no rollback needed
    // because the status was never changed in the DB.
    const projectedTimestamp = now();
    const projectedTask: Task = { ...validatedTask, status: toStatus, updatedAt: projectedTimestamp };

    // Partition hooks into required vs non-required
    const requiredHooks = (transition.hooks ?? []).filter(h => h.policy === 'required');
    const nonRequiredHooks = (transition.hooks ?? []).filter(h => h.policy !== 'required');

    // Acquire in-flight lock before running required hooks
    this.transitionsInFlight.add(task.id);

    let requiredHookFailures: HookFailure[] = [];
    try {
      // Run required hooks with the projected (unpersisted) task
      if (requiredHooks.length > 0) {
        requiredHookFailures = await this.executeHooks(requiredHooks, projectedTask, transition, ctx, task.id, undefined, onPostLog);
      }

      const requiredFailures = requiredHookFailures.filter(f => f.policy === 'required');
      if (requiredFailures.length > 0) {
        // Required hook failed — no rollback needed (status was never changed)
        await this.taskEventLog.log({
          taskId: task.id,
          category: 'system',
          severity: 'error',
          message: `Transition ${task.status} → ${toStatus} aborted: required hook(s) failed`,
          data: { failures: requiredFailures.map(f => ({ hook: f.hook, error: f.error })) },
          correlationId: ctx.correlationId,
        });
        // Check if the failed hook requested a follow-up transition.
        // Release the in-flight lock first so the follow-up transition is not blocked.
        const followUp = requiredFailures.find(f => f.followUpTransition)?.followUpTransition;
        if (followUp) {
          this.transitionsInFlight.delete(task.id);
          const latestTask = this.taskStore.getTaskSync(task.id);
          if (!latestTask) {
            getAppLogger().error('PipelineEngine', `Follow-up transition skipped: task ${task.id} not found after hook failure`);
          } else {
            this.taskEventLog.log({
              taskId: task.id,
              category: 'system',
              severity: 'info',
              message: `Dispatching follow-up transition to "${followUp.to}" after hook failure`,
              data: { followUpTo: followUp.to, followUpTrigger: followUp.trigger },
              correlationId: ctx.correlationId,
            }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));

            this.executeTransition(latestTask, followUp.to, { trigger: followUp.trigger, actor: ctx.actor, correlationId: ctx.correlationId })
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
          hookFailures: requiredHookFailures,
        };
      }

      // ── Phase 3: Status commit (synchronous transaction) ────────────
      // All required hooks passed — now persist the status change.
      // Re-verify task status hasn't changed (TOCTOU check).
      let updatedTask: Task | null = null;
      try {
        this.txRunner.runTransaction(() => {
          const currentTask = this.taskStore.getTaskSync(task.id);
          if (!currentTask) {
            throw new Error(`Task not found: ${task.id}`);
          }
          if (currentTask.status !== task.status) {
            throw new Error(`Task status changed during hook execution: expected "${task.status}", got "${currentTask.status}"`);
          }
          updatedTask = this.applyStatusUpdate(currentTask, task.id, task.status, toStatus, ctx, guardResults);
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }

      if (!updatedTask) {
        return { success: false, error: 'Status commit transaction completed but task was not updated' };
      }

      // ── Phase 4: Post-commit operations ────────────────────────────
      // Release the in-flight lock before running non-required hooks.
      // Non-required hooks (e.g. advance_phase) may internally call executeTransition,
      // which would be blocked by the lock if we kept it held. The status is already
      // committed, so the lock is no longer needed for crash safety.
      this.transitionsInFlight.delete(task.id);

      // Log status_change event (only now, since status is actually persisted)
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
        correlationId: ctx.correlationId,
      });

      // Run non-required hooks (best_effort and fire_and_forget) after status is committed
      let nonRequiredHookFailures: HookFailure[] = [];
      if (nonRequiredHooks.length > 0) {
        nonRequiredHookFailures = await this.executeHooks(nonRequiredHooks, updatedTask, transition, ctx, task.id, undefined, onPostLog);
      }

      const allHookFailures = [...requiredHookFailures, ...nonRequiredHookFailures];
      return { success: true, task: updatedTask, ...(allHookFailures.length > 0 ? { hookFailures: allHookFailures } : {}) };
    } finally {
      // Safety net: ensure lock is always released (no-op if already released above)
      this.transitionsInFlight.delete(task.id);
    }
    } // end for (transition of candidateTransitions)

    // All candidate transitions were blocked by guards — log and return failure
    this.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      severity: 'warning',
      message: `Transition ${task.status} → ${toStatus} blocked by guards: ${lastGuardFailures.map(g => `${g.guard}: ${g.reason}`).join('; ')}`,
      data: { fromStatus: task.status, toStatus, trigger: ctx.trigger, guardFailures: lastGuardFailures },
    }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
    return { success: false, error: lastGuardFailures.map(g => `${g.guard}: ${g.reason}`).join('; '), guardFailures: lastGuardFailures };
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

    try {
      this.txRunner.runTransaction(() => {
        const freshTask = this.taskStore.getTaskSync(task.id);
        if (!freshTask) {
          throw new Error(`Task not found: ${task.id}`);
        }
        if (freshTask.status !== task.status) {
          throw new Error(`Task status changed: expected "${task.status}", got "${freshTask.status}"`);
        }

        // Skip guards — this is a force transition
        updatedTask = this.applyStatusUpdate(freshTask, task.id, task.status, toStatus, ctx, { _forced: true });
      });
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
        const result = guardFn(task, transition, { trigger }, this.guardContext, guard.params);
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
   * Must be called inside a txRunner.runTransaction() callback.
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
    this.taskStore.updateTaskStatusSync(taskId, toStatus, timestamp);

    this.pipelineStore.recordTransitionSync({
      id: generateId(),
      taskId,
      fromStatus,
      toStatus,
      trigger: ctx.trigger,
      actor: ctx.actor ?? null,
      guardResults,
      createdAt: timestamp,
      correlationId: ctx.correlationId,
    });

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
        ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
      };
      const correlationId = ctx.correlationId;

      if (!hookFn) {
        if (forced) {
          await this.taskEventLog.log({
            taskId, correlationId,
            category: 'system',
            severity: 'warning',
            message: `Hook "${hook.name}" not registered (skipped during force transition)`,
            data: { hookName: hook.name, forced: true },
          });
        } else {
          const failure: HookFailure = { hook: hook.name, error: `Hook "${hook.name}" not registered`, policy };
          hookFailures.push(failure);
          this.taskEventLog.log({
            taskId, correlationId,
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
          taskId, correlationId,
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
            taskId, correlationId,
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
            taskId, correlationId,
            category: 'system',
            severity: 'error',
            message: `Hook "${hook.name}" failed (fire_and_forget${forced ? ', forced' : ''}): ${message}`,
            data: { hookName: hook.name, error: message, ...(forced ? { forced: true } : {}) },
          }).catch((logErr) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', logErr));
          // Log hook_execution event for fire_and_forget failure
          this.taskEventLog.log({
            taskId, correlationId,
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
        taskId, correlationId,
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
            taskId, correlationId,
            category: 'system',
            severity,
            message: `Hook "${hook.name}" failed${forced ? ' during force transition' : ''} (${policy}): ${failure.error}`,
            data: { hookName: hook.name, error: failure.error, policy, ...(forced ? { forced: true } : {}) },
          }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
          // Log hook_execution event for failure
          this.taskEventLog.log({
            taskId, correlationId,
            category: 'hook_execution',
            severity,
            message: `Hook "${hook.name}" failed (${policy}): ${failure.error}`,
            data: { ...hookEventBase, result: 'failure', error: failure.error, duration },
          }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
        } else {
          onPostLog?.('pipeline', `Hook "${hook.name}" succeeded (${policy})`, { hookName: hook.name, policy }, duration);
          // Log system event for success
          this.taskEventLog.log({
            taskId, correlationId,
            category: 'system',
            severity: 'info',
            message: `Hook "${hook.name}" succeeded (${policy})`,
            data: { hookName: hook.name, policy },
          }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
          // Log hook_execution event for success
          this.taskEventLog.log({
            taskId, correlationId,
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
          taskId, correlationId,
          category: 'system',
          severity,
          message: `Hook "${hook.name}" threw${forced ? ' during force transition' : ''} (${policy}): ${message}`,
          data: { hookName: hook.name, error: message, policy, ...(forced ? { forced: true } : {}) },
        }).catch((err) => getAppLogger().logError('PipelineEngine', 'Audit log write failed', err));
        // Log hook_execution event for thrown error
        this.taskEventLog.log({
          taskId, correlationId,
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
      this.txRunner.runTransaction(() => {
        const rollbackTimestamp = now();
        this.taskStore.updateTaskStatusSync(taskId, originalStatus, rollbackTimestamp);
        this.pipelineStore.recordTransitionSync({
          id: generateId(),
          taskId,
          fromStatus: failedToStatus,
          toStatus: originalStatus,
          trigger: ctx.trigger,
          actor: ctx.actor ?? null,
          guardResults: { _rollback: true, failures: requiredFailures.map(f => ({ hook: f.hook, error: f.error })) },
          createdAt: rollbackTimestamp,
        });
      });
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
