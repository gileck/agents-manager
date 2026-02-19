import type Database from 'better-sqlite3';
import type { Task, TaskCreateInput, TaskUpdateInput, TaskFilter, Subtask } from '../../shared/types';
import type { ITaskStore } from '../interfaces/task-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import { generateId, now, parseJson } from './utils';

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
    featureId: row.feature_id,
    assignee: row.assignee,
    prLink: row.pr_link,
    branchName: row.branch_name,
    plan: row.plan,
    subtasks: parseJson<Subtask[]>(row.subtasks, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteTaskStore implements ITaskStore {
  constructor(
    private db: Database.Database,
    private pipelineStore: IPipelineStore,
  ) {}

  async getTask(id: string): Promise<Task | null> {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.projectId) {
      conditions.push('project_id = ?');
      values.push(filter.projectId);
    }
    if (filter?.pipelineId) {
      conditions.push('pipeline_id = ?');
      values.push(filter.pipelineId);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      values.push(filter.status);
    }
    if (filter?.priority !== undefined) {
      conditions.push('priority = ?');
      values.push(filter.priority);
    }
    if (filter?.assignee) {
      conditions.push('assignee = ?');
      values.push(filter.assignee);
    }
    if (filter?.parentTaskId !== undefined) {
      if (filter.parentTaskId === null) {
        conditions.push('parent_task_id IS NULL');
      } else {
        conditions.push('parent_task_id = ?');
        values.push(filter.parentTaskId);
      }
    }
    if (filter?.featureId !== undefined) {
      if (filter.featureId === null) {
        conditions.push('feature_id IS NULL');
      } else {
        conditions.push('feature_id = ?');
        values.push(filter.featureId);
      }
    }
    if (filter?.tag) {
      conditions.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)");
      values.push(filter.tag);
    }
    if (filter?.search) {
      conditions.push("(title LIKE ? OR description LIKE ?)");
      const pattern = `%${filter.search}%`;
      values.push(pattern, pattern);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`).all(...values) as TaskRow[];
    return rows.map(rowToTask);
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const id = generateId();
    const timestamp = now();

    // Determine default status from pipeline's first status
    let status = input.status;
    if (!status) {
      const pipeline = await this.pipelineStore.getPipeline(input.pipelineId);
      if (pipeline && pipeline.statuses.length > 0) {
        status = pipeline.statuses[0].name;
      } else {
        status = 'open';
      }
    }

    this.db.prepare(`
      INSERT INTO tasks (id, project_id, pipeline_id, title, description, status, priority, tags, parent_task_id, feature_id, assignee, pr_link, branch_name, plan, subtasks, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.pipelineId,
      input.title,
      input.description ?? null,
      status,
      input.priority ?? 0,
      JSON.stringify(input.tags ?? []),
      input.parentTaskId ?? null,
      input.featureId ?? null,
      input.assignee ?? null,
      input.prLink ?? null,
      input.branchName ?? null,
      null,
      JSON.stringify(input.subtasks ?? []),
      JSON.stringify(input.metadata ?? {}),
      timestamp,
      timestamp,
    );

    return (await this.getTask(id))!;
  }

  async updateTask(id: string, input: TaskUpdateInput): Promise<Task | null> {
    const existing = await this.getTask(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.title !== undefined) {
      updates.push('title = ?');
      values.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (input.priority !== undefined) {
      updates.push('priority = ?');
      values.push(input.priority);
    }
    if (input.tags !== undefined) {
      updates.push('tags = ?');
      values.push(JSON.stringify(input.tags));
    }
    if (input.parentTaskId !== undefined) {
      updates.push('parent_task_id = ?');
      values.push(input.parentTaskId);
    }
    if (input.featureId !== undefined) {
      updates.push('feature_id = ?');
      values.push(input.featureId);
    }
    if (input.assignee !== undefined) {
      updates.push('assignee = ?');
      values.push(input.assignee);
    }
    if (input.prLink !== undefined) {
      updates.push('pr_link = ?');
      values.push(input.prLink);
    }
    if (input.branchName !== undefined) {
      updates.push('branch_name = ?');
      values.push(input.branchName);
    }
    if (input.plan !== undefined) {
      updates.push('plan = ?');
      values.push(input.plan);
    }
    if (input.subtasks !== undefined) {
      updates.push('subtasks = ?');
      values.push(JSON.stringify(input.subtasks));
    }
    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = ?');
    values.push(now());
    values.push(id);

    this.db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return (await this.getTask(id))!;
  }

  async deleteTask(id: string): Promise<boolean> {
    // Delete all related records that reference this task
    this.db.prepare('DELETE FROM task_context_entries WHERE task_id = ?').run(id);
    this.db.prepare('DELETE FROM pending_prompts WHERE task_id = ?').run(id);
    this.db.prepare('DELETE FROM task_phases WHERE task_id = ?').run(id);
    this.db.prepare('DELETE FROM task_artifacts WHERE task_id = ?').run(id);
    this.db.prepare('DELETE FROM agent_runs WHERE task_id = ?').run(id);
    this.db.prepare('DELETE FROM task_events WHERE task_id = ?').run(id);
    this.db.prepare('DELETE FROM transition_history WHERE task_id = ?').run(id);
    this.db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?').run(id, id);
    // Clear parent reference on child tasks
    this.db.prepare('UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id = ?').run(id);
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async addDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    this.db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id)
      VALUES (?, ?)
    `).run(taskId, dependsOnTaskId);
  }

  async removeDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    this.db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?').run(taskId, dependsOnTaskId);
  }

  async getDependencies(taskId: string): Promise<Task[]> {
    const rows = this.db.prepare(`
      SELECT t.* FROM tasks t
      JOIN task_dependencies td ON t.id = td.depends_on_task_id
      WHERE td.task_id = ?
      ORDER BY t.created_at DESC
    `).all(taskId) as TaskRow[];
    return rows.map(rowToTask);
  }

  async getDependents(taskId: string): Promise<Task[]> {
    const rows = this.db.prepare(`
      SELECT t.* FROM tasks t
      JOIN task_dependencies td ON t.id = td.task_id
      WHERE td.depends_on_task_id = ?
      ORDER BY t.created_at DESC
    `).all(taskId) as TaskRow[];
    return rows.map(rowToTask);
  }
}
