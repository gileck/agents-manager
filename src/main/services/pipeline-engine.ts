import type Database from 'better-sqlite3';
import type {
  Task,
  Subtask,
  Transition,
  TransitionTrigger,
  TransitionContext,
  TransitionResult,
  GuardFn,
  GuardResult,
  HookFn,
  PipelineStatus,
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
  subtasks: string;
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
    assignee: row.assignee,
    prLink: row.pr_link,
    branchName: row.branch_name,
    subtasks: parseJson<Subtask[]>(row.subtasks, []),
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
      if (t.from !== task.status) return false;
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

    // Find matching transition — prefer exact trigger match, fall back to any match
    const transition = pipeline.transitions.find(
      (t) => t.from === task.status && t.to === toStatus && t.trigger === ctx.trigger,
    ) ?? pipeline.transitions.find(
      (t) => t.from === task.status && t.to === toStatus,
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
          const result = guardFn(freshTask, transition, ctx, this.db);
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

    return { success: true, task: updatedTask };
  }
}
