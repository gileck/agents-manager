import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { getBaselineSchema, BASELINE_MIGRATION_NAMES } from '../../src/core/schema';

interface TableInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function openBaselineDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(getBaselineSchema());

  return db;
}

function getTableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence' ORDER BY name").all() as { name: string }[])
    .map(r => r.name);
}

function getIndexNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all() as { name: string }[])
    .map(r => r.name);
}

function getTableColumns(db: Database.Database, table: string): TableInfo[] {
  return db.prepare(`PRAGMA table_info('${table}')`).all() as TableInfo[];
}

/** Expected tables in the final schema (alphabetical). */
const EXPECTED_TABLES = [
  'activity_log',
  'agent_definitions',
  'agent_runs',
  'app_debug_log',
  'automated_agents',
  'chat_messages',
  'chat_sessions',
  'features',
  'kanban_boards',
  'migrations',
  'pending_prompts',
  'pipelines',
  'projects',
  'settings',
  'task_artifacts',
  'task_context_entries',
  'task_dependencies',
  'task_events',
  'task_phases',
  'tasks',
  'transition_history',
  'users',
];

describe('schema-baseline', () => {
  it('should create all expected tables', () => {
    const db = openBaselineDb();
    const tables = getTableNames(db);
    expect(tables).toEqual(EXPECTED_TABLES);
    db.close();
  });

  it('should create the tasks table with all expected columns', () => {
    const db = openBaselineDb();
    const cols = getTableColumns(db, 'tasks').map(c => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('project_id');
    expect(cols).toContain('pipeline_id');
    expect(cols).toContain('title');
    expect(cols).toContain('status');
    expect(cols).toContain('subtasks');
    expect(cols).toContain('plan');
    expect(cols).toContain('feature_id');
    expect(cols).toContain('plan_comments');
    expect(cols).toContain('technical_design');
    expect(cols).toContain('technical_design_comments');
    expect(cols).toContain('phases');
    expect(cols).toContain('debug_info');
    db.close();
  });

  it('should create the agent_runs table with all expected columns', () => {
    const db = openBaselineDb();
    const cols = getTableColumns(db, 'agent_runs').map(c => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('task_id');
    expect(cols).toContain('mode');
    expect(cols).toContain('prompt');
    expect(cols).toContain('error');
    expect(cols).toContain('timeout_ms');
    expect(cols).toContain('max_turns');
    expect(cols).toContain('message_count');
    expect(cols).toContain('messages');
    expect(cols).toContain('automated_agent_id');
    db.close();
  });

  it('should create all expected indexes', () => {
    const db = openBaselineDb();
    const indexes = getIndexNames(db);
    // Spot-check key indexes
    expect(indexes).toContain('idx_tasks_project_id');
    expect(indexes).toContain('idx_tasks_status');
    expect(indexes).toContain('idx_agent_runs_task_id');
    expect(indexes).toContain('idx_chat_sessions_scope');
    expect(indexes).toContain('idx_automated_agents_project');
    expect(indexes).toContain('idx_app_debug_log_created_at');
    expect(indexes).toContain('idx_features_project_id');
    expect(indexes.length).toBeGreaterThanOrEqual(30);
    db.close();
  });

  it('should seed settings', () => {
    const db = openBaselineDb();
    const settings = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as { key: string; value: string }[];
    const keys = settings.map(s => s.key);
    expect(keys).toContain('theme');
    expect(keys).toContain('notifications_enabled');
    expect(keys).toContain('chat_default_agent_lib');
    expect(keys).toContain('default_pipeline_id');
    expect(settings.find(s => s.key === 'default_pipeline_id')!.value).toBe('pipeline-agent');
    db.close();
  });

  it('should seed the agent pipeline', () => {
    const db = openBaselineDb();
    const pipelines = db.prepare('SELECT id, name, task_type, statuses, transitions FROM pipelines ORDER BY id').all() as { id: string; name: string; task_type: string; statuses: string; transitions: string }[];
    expect(pipelines.length).toBe(1);
    expect(pipelines[0].id).toBe('pipeline-agent');
    expect(pipelines[0].name).toBe('Agent-Driven');
    expect(pipelines[0].task_type).toBe('agent');

    const statuses = JSON.parse(pipelines[0].statuses);
    expect(statuses.length).toBeGreaterThanOrEqual(10);
    expect(statuses[0].name).toBe('open');

    const transitions = JSON.parse(pipelines[0].transitions);
    expect(transitions.length).toBeGreaterThan(20);
    db.close();
  });

  it('should seed all 8 agent definitions', () => {
    const db = openBaselineDb();
    const defs = db.prepare('SELECT id, name, engine, is_built_in FROM agent_definitions ORDER BY id').all() as { id: string; name: string; engine: string; is_built_in: number }[];
    expect(defs.length).toBe(8);

    const builtIn = defs.filter(d => d.is_built_in === 1);
    expect(builtIn.length).toBe(6);

    const ids = defs.map(d => d.id);
    expect(ids).toContain('agent-def-implementor');
    expect(ids).toContain('agent-def-planner');
    expect(ids).toContain('agent-def-designer');
    expect(ids).toContain('agent-def-investigator');
    expect(ids).toContain('agent-def-reviewer');
    expect(ids).toContain('agent-def-task-workflow-reviewer');
    expect(ids).toContain('agent-def-cursor-agent');
    expect(ids).toContain('agent-def-codex-cli');
    db.close();
  });

  it('should seed the admin user', () => {
    const db = openBaselineDb();
    const users = db.prepare('SELECT id, username, role FROM users ORDER BY id').all() as { id: string; username: string; role: string }[];
    expect(users.length).toBe(1);
    expect(users[0]).toEqual({ id: 'user-admin', username: 'admin', role: 'admin' });
    db.close();
  });

  it('should enforce foreign key constraints', () => {
    const db = openBaselineDb();
    db.pragma('foreign_keys = ON');
    // Inserting a task with a non-existent project_id should fail
    expect(() => {
      db.prepare(
        "INSERT INTO tasks (id, project_id, pipeline_id, title, status, priority, tags, subtasks, plan_comments, metadata, created_at, updated_at) VALUES ('t1', 'nonexistent', 'pipeline-agent', 'Test', 'open', 0, '[]', '[]', '[]', '{}', 1, 1)",
      ).run();
    }).toThrow();
    db.close();
  });

  it('should have 88 baseline migration names', () => {
    expect(BASELINE_MIGRATION_NAMES.length).toBe(88);
    expect(BASELINE_MIGRATION_NAMES[0]).toBe('001_create_items');
    expect(BASELINE_MIGRATION_NAMES[87]).toBe('098_add_created_by_to_tasks');
  });
});
