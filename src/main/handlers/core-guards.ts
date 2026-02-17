import type Database from 'better-sqlite3';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { Task, Transition, TransitionContext, GuardResult } from '../../shared/types';

export function registerCoreGuards(engine: IPipelineEngine, db: Database.Database): void {
  engine.registerGuard('has_pr', (task: Task): GuardResult => {
    if (task.prLink) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Task must have a PR link' };
  });

  engine.registerGuard('dependencies_resolved', (task: Task, _transition: Transition, _context: TransitionContext, dbRef: unknown): GuardResult => {
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

  engine.registerGuard('no_running_agent', (task: Task, _transition: Transition, _context: TransitionContext, dbRef: unknown): GuardResult => {
    const sqliteDb = dbRef as Database.Database;
    const row = sqliteDb.prepare(
      'SELECT COUNT(*) as count FROM agent_runs WHERE task_id = ? AND status = ?'
    ).get(task.id, 'running') as { count: number };
    if (row.count > 0) {
      return { allowed: false, reason: 'An agent is already running for this task' };
    }
    return { allowed: true };
  });
}
