import type Database from 'better-sqlite3';
import type {
  Task,
  Transition,
  TransitionTrigger,
  TransitionContext,
  TransitionResult,
  GuardFn,
  GuardResult,
  HookFn,
} from '../../shared/types';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import { generateId, now } from '../stores/utils';

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

  getValidTransitions(task: Task, trigger?: TransitionTrigger): Transition[] {
    const pipeline = this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return [];

    return pipeline.transitions.filter((t) => {
      if (t.from !== task.status) return false;
      if (trigger && t.trigger !== trigger) return false;
      return true;
    });
  }

  executeTransition(task: Task, toStatus: string, context?: TransitionContext): TransitionResult {
    const ctx: TransitionContext = context ?? { trigger: 'manual' };

    const pipeline = this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) {
      return { success: false, error: `Pipeline not found: ${task.pipelineId}` };
    }

    // Find matching transition
    const transition = pipeline.transitions.find(
      (t) => t.from === task.status && t.to === toStatus,
    );
    if (!transition) {
      return {
        success: false,
        error: `No transition from "${task.status}" to "${toStatus}" in pipeline "${pipeline.name}"`,
      };
    }

    // Execute atomically within a transaction
    let updatedTask: Task | null = null;
    const guardResults: Record<string, GuardResult> = {};
    const guardFailures: Array<{ guard: string; reason: string }> = [];

    const txn = this.db.transaction(() => {
      // Re-fetch task inside transaction (TOCTOU protection)
      const freshTask = this.taskStore.getTask(task.id);
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
          const result = guardFn(freshTask, transition, ctx, this.db);
          guardResults[guard.name] = result;
          if (!result.allowed) {
            guardFailures.push({ guard: guard.name, reason: result.reason ?? 'Guard check failed' });
          }
        }
      }

      if (guardFailures.length > 0) {
        return; // Will return failure after transaction
      }

      // Update task status
      updatedTask = this.taskStore.updateTask(task.id, { status: toStatus });

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
        now(),
      );
    });

    try {
      txn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }

    if (guardFailures.length > 0) {
      return { success: false, guardFailures };
    }

    if (!updatedTask) {
      return { success: false, error: 'Transaction completed but task was not updated' };
    }

    // Run hooks after transaction (failures logged, don't rollback)
    if (transition.hooks) {
      for (const hook of transition.hooks) {
        const hookFn = this.hooks.get(hook.name);
        if (hookFn) {
          hookFn(updatedTask, transition, ctx).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.taskEventLog.log({
              taskId: task.id,
              category: 'system',
              severity: 'error',
              message: `Hook "${hook.name}" failed: ${message}`,
              data: { hook: hook.name, error: message },
            });
          });
        }
      }
    }

    // Log status_change event
    this.taskEventLog.log({
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

    return { success: true, task: updatedTask };
  }
}
