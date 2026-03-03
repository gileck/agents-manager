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
  return [];
}
