import { AGENT_PIPELINE } from './data/seeded-pipelines';

export interface Migration {
  name: string;
  sql: string;
}

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Returns incremental migrations to run AFTER the baseline schema.
 * The baseline (src/core/schema.ts) covers migrations 001–087 and 098.
 * Migrations whose names appear in BASELINE_MIGRATION_NAMES are skipped
 * by the production db.ts runner (and test helpers) since they are already
 * applied via the baseline DDL.
 */
export function getMigrations(): Migration[] {
  return [
    {
      name: '088_add_model_to_agent_runs',
      sql: `ALTER TABLE agent_runs ADD COLUMN model TEXT`,
    },
    {
      name: '089_add_type_to_tasks',
      sql: `ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'feature' CHECK(type IN ('bug','feature','improvement'))`,
    },
    {
      name: '090_add_size_to_tasks',
      sql: `ALTER TABLE tasks ADD COLUMN size TEXT DEFAULT NULL CHECK(size IS NULL OR size IN ('xs','sm','md','lg','xl'))`,
    },
    {
      name: '091_add_complexity_to_tasks',
      sql: `ALTER TABLE tasks ADD COLUMN complexity TEXT DEFAULT NULL CHECK(complexity IS NULL OR complexity IN ('low','medium','high'))`,
    },
    {
      name: '092_reseed_pipelines_close_reopen',
      sql: `UPDATE pipelines SET statuses = '${escSql(JSON.stringify(AGENT_PIPELINE.statuses))}', transitions = '${escSql(JSON.stringify(AGENT_PIPELINE.transitions))}' WHERE id = '${escSql(AGENT_PIPELINE.id)}'`,
    },
    {
      name: '093_add_engine_to_agent_runs',
      sql: `ALTER TABLE agent_runs ADD COLUMN engine TEXT`,
    },
    {
      name: '094_add_model_to_chat_sessions',
      sql: `ALTER TABLE chat_sessions ADD COLUMN model TEXT`,
    },
    {
      name: '095_add_agent_role_to_chat_sessions',
      sql: `ALTER TABLE chat_sessions ADD COLUMN agent_role TEXT`,
    },
    {
      name: '096_add_agent_run_id_to_chat_sessions',
      sql: `ALTER TABLE chat_sessions ADD COLUMN agent_run_id TEXT`,
    },
    {
      name: '097_reseed_pipelines_phase_auto_merge',
      sql: `UPDATE pipelines SET statuses = '${escSql(JSON.stringify(AGENT_PIPELINE.statuses))}', transitions = '${escSql(JSON.stringify(AGENT_PIPELINE.transitions))}' WHERE id = '${escSql(AGENT_PIPELINE.id)}'`,
    },
    {
      name: '098_add_created_by_to_tasks',
      sql: `ALTER TABLE tasks ADD COLUMN created_by TEXT`,
    },
    {
      name: '099_create_app_notifications',
      sql: `
CREATE TABLE IF NOT EXISTS app_notifications (
  id           TEXT    PRIMARY KEY,
  task_id      TEXT    NOT NULL,
  project_id   TEXT,
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  navigation_url TEXT  NOT NULL,
  read         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_notif_project ON app_notifications (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_notif_unread  ON app_notifications (read, created_at)`,
    },
    {
      name: '100_add_permission_mode_to_chat_sessions',
      sql: `ALTER TABLE chat_sessions ADD COLUMN permission_mode TEXT DEFAULT NULL`,
    },
    {
      name: '101_add_session_id_to_agent_runs',
      sql: `ALTER TABLE agent_runs ADD COLUMN session_id TEXT`,
    },
    {
      name: '102_reseed_pipelines_backlog_status',
      sql: `UPDATE pipelines SET statuses = '${escSql(JSON.stringify(AGENT_PIPELINE.statuses))}', transitions = '${escSql(JSON.stringify(AGENT_PIPELINE.transitions))}' WHERE id = '${escSql(AGENT_PIPELINE.id)}'`,
    },
    {
      name: '103_add_cache_tokens_and_cost_usd_to_agent_runs',
      sql: `
ALTER TABLE agent_runs ADD COLUMN cache_read_input_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN cache_creation_input_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN total_cost_usd REAL`,
    },
    {
      name: '104_add_cache_tokens_and_cost_usd_to_chat_messages',
      sql: `
ALTER TABLE chat_messages ADD COLUMN cache_read_input_tokens INTEGER;
ALTER TABLE chat_messages ADD COLUMN cache_creation_input_tokens INTEGER;
ALTER TABLE chat_messages ADD COLUMN total_cost_usd REAL`,
    },
    {
      name: '105_reseed_pipelines_status_colors',
      sql: `UPDATE pipelines SET statuses = '${escSql(JSON.stringify(AGENT_PIPELINE.statuses))}' WHERE id = '${escSql(AGENT_PIPELINE.id)}'`,
    },
    {
      name: '106_add_sidebar_hidden_to_chat_sessions',
      sql: `ALTER TABLE chat_sessions ADD COLUMN sidebar_hidden INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: '107_add_last_context_input_tokens_to_chat_messages',
      sql: `ALTER TABLE chat_messages ADD COLUMN last_context_input_tokens INTEGER DEFAULT NULL`,
    },
    {
      name: '108_add_task_ids_to_chat_sessions',
      sql: `ALTER TABLE chat_sessions ADD COLUMN task_ids TEXT NOT NULL DEFAULT '[]'`,
    },
    {
      name: '109_add_system_prompt_append_to_chat_sessions',
      sql: `ALTER TABLE chat_sessions ADD COLUMN system_prompt_append TEXT DEFAULT NULL`,
    },
    {
      name: '110_reseed_pipelines_already_on_main',
      sql: `UPDATE pipelines SET transitions = '${escSql(JSON.stringify(AGENT_PIPELINE.transitions))}' WHERE id = '${escSql(AGENT_PIPELINE.id)}'`,
    },
    {
      name: '111_add_diagnostics_to_agent_runs',
      sql: `ALTER TABLE agent_runs ADD COLUMN diagnostics TEXT`,
    },
    {
      name: '112_fix_already_on_main_to_ready_to_merge',
      sql: `UPDATE pipelines SET transitions = '${escSql(JSON.stringify(AGENT_PIPELINE.transitions))}' WHERE id = '${escSql(AGENT_PIPELINE.id)}'`,
    },
    {
      name: '113_add_dismissed_to_task_events',
      sql: `ALTER TABLE task_events ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: '114_add_enable_streaming_to_chat_sessions',
      sql: `ALTER TABLE chat_sessions ADD COLUMN enable_streaming INTEGER NOT NULL DEFAULT 1`,
    },
  ];
}
