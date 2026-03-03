export interface Migration {
  name: string;
  sql: string;
}

/**
 * Returns incremental migrations to run AFTER the baseline schema.
 * The baseline (src/core/schema.ts) covers migrations 001–087.
 * New migrations start at 088 and are appended here.
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
  ];
}
