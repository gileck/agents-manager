import type { Migration } from '@template/main/services/database';
import { SEEDED_PIPELINES } from './data/seeded-pipelines';

export function getMigrations(): Migration[] {
  return [
    {
      name: '001_create_items',
      sql: `
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `,
    },
    {
      name: '002_create_settings',
      sql: `
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        -- Insert default settings
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('theme', 'system'),
          ('notifications_enabled', 'true')
      `,
    },
    {
      name: '003_create_logs',
      sql: `
        CREATE TABLE IF NOT EXISTS logs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          level TEXT NOT NULL DEFAULT 'info',
          message TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_logs_run_id ON logs(run_id);
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)
      `,
    },
    {
      name: '004_create_pipelines',
      sql: `
        CREATE TABLE IF NOT EXISTS pipelines (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          statuses TEXT NOT NULL,
          transitions TEXT NOT NULL,
          task_type TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `,
    },
    {
      name: '005_create_projects',
      sql: `
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          path TEXT,
          config TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `,
    },
    {
      name: '006_create_tasks',
      sql: `
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          pipeline_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          tags TEXT NOT NULL DEFAULT '[]',
          parent_task_id TEXT,
          assignee TEXT,
          pr_link TEXT,
          branch_name TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id),
          FOREIGN KEY (pipeline_id) REFERENCES pipelines(id),
          FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
        )
      `,
    },
    {
      name: '007_create_task_dependencies',
      sql: `
        CREATE TABLE IF NOT EXISTS task_dependencies (
          task_id TEXT NOT NULL,
          depends_on_task_id TEXT NOT NULL,
          PRIMARY KEY (task_id, depends_on_task_id),
          FOREIGN KEY (task_id) REFERENCES tasks(id),
          FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
        )
      `,
    },
    {
      name: '008_create_transition_history',
      sql: `
        CREATE TABLE IF NOT EXISTS transition_history (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          from_status TEXT NOT NULL,
          to_status TEXT NOT NULL,
          trigger TEXT NOT NULL,
          actor TEXT,
          guard_results TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id)
        )
      `,
    },
    {
      name: '009_create_task_events',
      sql: `
        CREATE TABLE IF NOT EXISTS task_events (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          category TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info',
          message TEXT NOT NULL,
          data TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id)
        )
      `,
    },
    {
      name: '010_create_activity_log',
      sql: `
        CREATE TABLE IF NOT EXISTS activity_log (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          data TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        )
      `,
    },
    {
      name: '011_seed_pipelines',
      sql: getSeedPipelinesSql(),
    },
    {
      name: '012_create_phase1_indexes',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_pipeline_id ON tasks(pipeline_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
        CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);
        CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
        CREATE INDEX IF NOT EXISTS idx_transition_history_task_id ON transition_history(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_events_category ON task_events(category);
        CREATE INDEX IF NOT EXISTS idx_task_events_created_at ON task_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
        CREATE INDEX IF NOT EXISTS idx_pipelines_task_type ON pipelines(task_type)
      `,
    },
  ];
}

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

function getSeedPipelinesSql(): string {
  const now = Date.now();
  const statements = SEEDED_PIPELINES.map((p) => {
    const id = escSql(p.id);
    const name = escSql(p.name);
    const desc = escSql(p.description);
    const taskType = escSql(p.taskType);
    const statuses = escSql(JSON.stringify(p.statuses));
    const transitions = escSql(JSON.stringify(p.transitions));
    return `INSERT OR IGNORE INTO pipelines (id, name, description, statuses, transitions, task_type, created_at, updated_at) VALUES ('${id}', '${name}', '${desc}', '${statuses}', '${transitions}', '${taskType}', ${now}, ${now})`;
  });
  return statements.join(';\n');
}
