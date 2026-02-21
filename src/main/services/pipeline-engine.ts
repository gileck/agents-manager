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
} from '../../shared/types';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import { generateId, now, parseJson } from '../stores/utils';

interface TaskRow {
  id: string;
  project_id: string;
  pipeline_id: string;
  title: string;
  description: string | null;
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
  subtasks: string;
  phases: string | null;
  plan_comments: string;
  technical_design_comments: string;
  metadata: string;
  created_at: number;
  updated_at: number;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    pipelineId: row.pipeline_id,
    title: row.title,
    description: row.description,
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
    subtasks: parseJson<Subtask[]>(row.subtasks, []),
    phases: row.phases ? parseJson<ImplementationPhase[] | null>(row.phases, null) : null,
    planComments: parseJson<PlanComment[]>(row.plan_comments, []),
    technicalDesignComments: parseJson<PlanComment[]>(row.technical_design_comments, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  async executeTransition(task: Task, toStatus: string, context?: TransitionContext): Promise<TransitionResult> {
    const ctx: TransitionContext = context ?? { trigger: 'manual' };

    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) {
      return { success: false, error: `Pipeline not found: ${task.pipelineId}` };
    }

    // Find matching transition — enforce trigger type match
    const fromMatch = (t: Transition) => t.from === task.status || t.from === '*';
    const transition = pipeline.transitions.find(
      (t) => fromMatch(t) && t.to === toStatus && t.trigger === ctx.trigger,
    );
    if (!transition) {
      return {
        success: false,
        error: `No transition from "${task.status}" to "${toStatus}" in pipeline "${pipeline.name}"`,
      };
    }

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
      }

      if (guardFailures.length > 0) {
        return;
      }

      // Update task status via raw SQL
      const timestamp = now();
      this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(toStatus, timestamp, task.id);

      // Build the updated task from what we know
      updatedTask = { ...freshTask, status: toStatus, updatedAt: timestamp };

      // Insert transition history
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
        JSON.stringify(guardResults),
        timestamp,
      );
    });

    try {
      txn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }

    if (guardFailures.length > 0) {
      // Log guard failures to the task event log so they're visible in the timeline
      this.taskEventLog.log({
        taskId: task.id,
        category: 'system',
        severity: 'warning',
        message: `Transition ${task.status} → ${toStatus} blocked by guards: ${guardFailures.map(g => `${g.guard}: ${g.reason}`).join('; ')}`,
        data: { fromStatus: task.status, toStatus, trigger: ctx.trigger, guardFailures },
      }).catch(() => {});
      return { success: false, guardFailures };
    }

    if (!updatedTask) {
      return { success: false, error: 'Transaction completed but task was not updated' };
    }

    // Run hooks after transaction
    const hookFailures: HookFailure[] = [];
    if (transition.hooks) {
      for (const hook of transition.hooks) {
        const hookFn = this.hooks.get(hook.name);
        const policy: HookExecutionPolicy = hook.policy ?? 'best_effort';

        if (!hookFn) {
          const failure: HookFailure = { hook: hook.name, error: `Hook "${hook.name}" not registered`, policy };
          hookFailures.push(failure);
          this.taskEventLog.log({
            taskId: task.id,
            category: 'system',
            severity: 'warning',
            message: `Hook "${hook.name}" not registered — skipping`,
            data: { hook: hook.name },
          }).catch(() => {});
          continue;
        }

        if (policy === 'fire_and_forget') {
          hookFn(updatedTask, transition, ctx, hook.params).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.taskEventLog.log({
              taskId: task.id,
              category: 'system',
              severity: 'error',
              message: `Hook "${hook.name}" failed (fire_and_forget): ${message}`,
              data: { hook: hook.name, error: message },
            });
          });
          continue;
        }

        // required or best_effort: await the hook
        try {
          const result = await hookFn(updatedTask, transition, ctx, hook.params);
          if (result && !result.success) {
            const failure: HookFailure = { hook: hook.name, error: result.error ?? 'Hook returned failure', policy };
            hookFailures.push(failure);
            this.taskEventLog.log({
              taskId: task.id,
              category: 'system',
              severity: policy === 'required' ? 'error' : 'warning',
              message: `Hook "${hook.name}" failed: ${failure.error}`,
              data: { hook: hook.name, error: failure.error, policy },
            }).catch(() => {});
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const failure: HookFailure = { hook: hook.name, error: message, policy };
          hookFailures.push(failure);
          this.taskEventLog.log({
            taskId: task.id,
            category: 'system',
            severity: policy === 'required' ? 'error' : 'warning',
            message: `Hook "${hook.name}" threw: ${message}`,
            data: { hook: hook.name, error: message, policy },
          }).catch(() => {});
        }
      }
    }

    // If any required hook failed, roll back the status change
    const requiredFailures = hookFailures.filter(f => f.policy === 'required');
    if (requiredFailures.length > 0) {
      await this.taskStore.updateTask(task.id, { status: task.status });
      await this.taskEventLog.log({
        taskId: task.id,
        category: 'system',
        severity: 'error',
        message: `Transition ${task.status} → ${toStatus} rolled back: required hook(s) failed`,
        data: { failures: requiredFailures.map(f => ({ hook: f.hook, error: f.error })) },
      });
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
      const freshTask = rowToTask(freshRow);

      // Skip guards — this is a force transition
      const timestamp = now();
      this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(toStatus, timestamp, task.id);
      updatedTask = { ...freshTask, status: toStatus, updatedAt: timestamp };

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
        JSON.stringify({ _forced: true }),
        timestamp,
      );
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
    const hookFailures: HookFailure[] = [];
    if (transition?.hooks) {
      for (const hook of transition.hooks) {
        const hookFn = this.hooks.get(hook.name);
        const policy: HookExecutionPolicy = hook.policy ?? 'best_effort';

        if (!hookFn) {
          await this.taskEventLog.log({
            taskId: task.id,
            category: 'system',
            severity: 'warning',
            message: `Hook "${hook.name}" not registered (skipped during force transition)`,
            data: { hook: hook.name, forced: true },
          });
          continue;
        }

        if (policy === 'fire_and_forget') {
          hookFn(updatedTask, transition, ctx, hook.params).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.taskEventLog.log({
              taskId: task.id,
              category: 'system',
              severity: 'error',
              message: `Hook "${hook.name}" failed (fire_and_forget, forced): ${message}`,
              data: { hook: hook.name, error: message },
            });
          });
          continue;
        }

        try {
          const result = await hookFn(updatedTask, transition, ctx, hook.params);
          if (result && !result.success) {
            hookFailures.push({ hook: hook.name, error: result.error ?? 'Hook returned failure', policy });
            await this.taskEventLog.log({
              taskId: task.id,
              category: 'system',
              severity: 'error',
              message: `Hook "${hook.name}" failed during force transition (${policy}): ${result.error ?? 'Hook returned failure'}`,
              data: { hook: hook.name, error: result.error, policy, forced: true },
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          hookFailures.push({ hook: hook.name, error: message, policy });
          await this.taskEventLog.log({
            taskId: task.id,
            category: 'system',
            severity: 'error',
            message: `Hook "${hook.name}" threw during force transition (${policy}): ${message}`,
            data: { hook: hook.name, error: message, policy, forced: true },
          });
        }
      }
    }

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

  async checkGuards(task: Task, toStatus: string, trigger: TransitionTrigger): Promise<GuardCheckResult | null> {
    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return null;

    const fromMatch = (t: Transition) => t.from === task.status || t.from === '*';
    const transition = pipeline.transitions.find(
      (t) => fromMatch(t) && t.to === toStatus && t.trigger === trigger,
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

    try {
      const result = await hookFn(task, transition, ctx, hookDef?.params);
      if (result && !result.success) {
        await this.taskEventLog.log({
          taskId: task.id,
          category: 'system',
          severity: 'warning',
          message: `Hook retry "${hookName}" failed: ${result.error ?? 'unknown'}`,
          data: { hookName, error: result.error },
        });
        return { success: false, hookName, error: result.error ?? 'Hook returned failure' };
      }

      await this.taskEventLog.log({
        taskId: task.id,
        category: 'system',
        severity: 'info',
        message: `Hook retry "${hookName}" succeeded`,
        data: { hookName },
      });
      return { success: true, hookName };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.taskEventLog.log({
        taskId: task.id,
        category: 'system',
        severity: 'error',
        message: `Hook retry "${hookName}" threw: ${message}`,
        data: { hookName, error: message },
      });
      return { success: false, hookName, error: message };
    }
  }
}
