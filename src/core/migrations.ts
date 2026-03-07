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
  ];
}
