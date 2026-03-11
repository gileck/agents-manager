import type Database from 'better-sqlite3';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { Task, Transition, TransitionContext, GuardResult } from '../../shared/types';
import { hasPendingPhases, hasFollowingPhases } from '../../shared/phase-utils';

export function registerCoreGuards(engine: IPipelineEngine, _db: Database.Database): void {
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

  engine.registerGuard('max_retries', (task: Task, _transition: Transition, _context: TransitionContext, dbRef: unknown, params?: Record<string, unknown>): GuardResult => {
    const sqliteDb = dbRef as Database.Database;
    const max = (params?.max as number) ?? 3;

    const row = sqliteDb.prepare(
      "SELECT COUNT(*) as count FROM agent_runs WHERE task_id = ? AND status IN ('failed', 'cancelled')"
    ).get(task.id) as { count: number };

    // count includes the run that just failed; first failure = count 1.
    // max: 3 means allow up to 3 retries (4 total attempts), so block when count > max.
    if (row.count > max) {
      return { allowed: false, reason: `Max retries (${max}) reached — ${row.count} failed runs` };
    }
    return { allowed: true };
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

  engine.registerGuard('has_pending_phases', (task: Task): GuardResult => {
    if (hasPendingPhases(task.phases)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'No pending implementation phases' };
  });

  engine.registerGuard('has_following_phases', (task: Task): GuardResult => {
    if (hasFollowingPhases(task.phases)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'No following pending phases' };
  });

  engine.registerGuard('is_admin', (_task: Task, _transition: Transition, context: TransitionContext, dbRef: unknown): GuardResult => {
    if (!context.actor) {
      return { allowed: false, reason: 'No actor provided - admin role required' };
    }

    const sqliteDb = dbRef as Database.Database;

    // Query the user directly since guards must be synchronous
    const userRow = sqliteDb.prepare('SELECT role FROM users WHERE username = ?').get(context.actor) as { role: string } | undefined;

    if (!userRow) {
      return { allowed: false, reason: 'User not found' };
    }

    if (userRow.role !== 'admin') {
      return { allowed: false, reason: 'Only administrators can perform this action' };
    }

    return { allowed: true };
  });
}
