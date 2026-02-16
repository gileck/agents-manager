import type Database from 'better-sqlite3';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IActivityLog } from '../interfaces/activity-log';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import { SqliteProjectStore } from '../stores/sqlite-project-store';
import { SqlitePipelineStore } from '../stores/sqlite-pipeline-store';
import { SqliteTaskStore } from '../stores/sqlite-task-store';
import { SqliteTaskEventLog } from '../stores/sqlite-task-event-log';
import { SqliteActivityLog } from '../stores/sqlite-activity-log';
import { PipelineEngine } from '../services/pipeline-engine';
import type { Task, Transition, TransitionContext, GuardResult } from '../../shared/types';

export interface AppServices {
  projectStore: IProjectStore;
  pipelineStore: IPipelineStore;
  taskStore: ITaskStore;
  taskEventLog: ITaskEventLog;
  activityLog: IActivityLog;
  pipelineEngine: IPipelineEngine;
}

export function createAppServices(db: Database.Database): AppServices {
  const projectStore = new SqliteProjectStore(db);
  const pipelineStore = new SqlitePipelineStore(db);
  const taskStore = new SqliteTaskStore(db, pipelineStore);
  const taskEventLog = new SqliteTaskEventLog(db);
  const activityLog = new SqliteActivityLog(db);
  const pipelineEngine = new PipelineEngine(pipelineStore, taskStore, taskEventLog, db);

  // Register built-in guards
  pipelineEngine.registerGuard('has_pr', (task: Task): GuardResult => {
    if (task.prLink) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Task must have a PR link' };
  });

  pipelineEngine.registerGuard('dependencies_resolved', (task: Task, _transition: Transition, _context: TransitionContext, dbRef: unknown): GuardResult => {
    const sqliteDb = dbRef as Database.Database;
    const row = sqliteDb.prepare(`
      SELECT COUNT(*) as count FROM task_dependencies td
      JOIN tasks t ON t.id = td.depends_on_task_id
      JOIN pipelines p ON p.id = t.pipeline_id
      WHERE td.task_id = ?
      AND t.status NOT IN (
        SELECT json_extract(s.value, '$.name')
        FROM pipelines p2, json_each(p2.statuses) s
        WHERE p2.id = t.pipeline_id
        AND json_extract(s.value, '$.isFinal') = 1
      )
    `).get(task.id) as { count: number };

    if (row.count === 0) {
      return { allowed: true };
    }
    return { allowed: false, reason: `${row.count} unresolved dependencies` };
  });

  return {
    projectStore,
    pipelineStore,
    taskStore,
    taskEventLog,
    activityLog,
    pipelineEngine,
  };
}
