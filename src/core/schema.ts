import { SEEDED_PIPELINES } from './data/seeded-pipelines';

/**
 * Baseline schema representing the database state after migrations 001–087 and 098.
 * Fresh databases apply this schema directly instead of running incremental migrations.
 * Existing databases continue using incremental migrations from getMigrations().
 *
 * Note: 098 is included because its column (created_by) was added to the baseline DDL.
 * Migrations 088–097 remain incremental and are applied after the baseline.
 */

/** Migration names folded into this baseline (001–087, 098). */
export const BASELINE_MIGRATION_NAMES: string[] = [
  '001_create_items',
  '002_create_settings',
  '003_create_logs',
  '004_create_pipelines',
  '005_create_projects',
  '006_create_tasks',
  '007_create_task_dependencies',
  '008_create_transition_history',
  '009_create_task_events',
  '010_create_activity_log',
  '011_seed_pipelines',
  '012_create_phase1_indexes',
  '013_create_agent_runs',
  '014_create_task_artifacts',
  '015_create_task_phases',
  '016_create_pending_prompts',
  '017_create_phase2_indexes',
  '018_update_agent_pipeline_hooks',
  '019_add_resume_outcome_to_pending_prompts',
  '020_update_agent_pipeline_hooks_v2',
  '021_update_agent_pipeline_retry',
  '022_create_task_context_entries',
  '023_add_request_changes_mode',
  '024_add_subtasks_column',
  '025_add_plan_column',
  '026_create_features',
  '027_add_feature_id_to_tasks',
  '028_create_agent_definitions',
  '029_add_plan_comments_column',
  '030_add_plan_revision_mode',
  '031_update_agent_pipeline_plan_revision',
  '032_update_agent_definitions_add_plan_revision',
  '033_split_agent_definitions',
  '034_add_bug_investigator',
  '035_set_default_bug_pipeline',
  '036_add_investigate_mode',
  '037_widen_agent_runs_for_investigate',
  '038_add_prompt_to_agent_runs',
  '039_update_pipelines_no_changes_outcome',
  '040_add_project_id_to_activity_log',
  '041_reseed_pipelines_hook_policies',
  '042_update_reviewer_default_branch',
  '043_reseed_pipeline_categories',
  '044_widen_agent_runs_for_resolve_conflicts',
  '045_reseed_pipelines_conflict_detection',
  '046_seed_workflow_reviewer_agent_definition',
  '047_add_technical_design_column',
  '048_add_technical_design_comments_column',
  '049_widen_agent_runs_for_technical_design',
  '050_reseed_pipelines_technical_design',
  '051_seed_technical_design_agent_definition',
  '052_create_chat_messages',
  '053_add_technical_design_to_implement_templates',
  '054_add_skills_to_agent_definitions',
  '055_reseed_pipelines_design_before_plan',
  '056_add_cost_to_chat_messages',
  '057_add_agent_run_progress_fields',
  '058_widen_agent_runs_for_resume_modes',
  '059_reseed_pipelines_resume_modes',
  '060_update_agent_prompt_templates',
  '061_add_phases_column',
  '062_reseed_pipelines_phases',
  '063_add_messages_to_agent_runs',
  '064_create_kanban_boards',
  '065_set_default_pipeline_agent',
  '066_create_project_chat_sessions',
  '067_update_chat_messages_to_sessions',
  '068_seed_cursor_codex_agent_definitions',
  '069_create_users',
  '070_drop_chat_messages_session_fk',
  '071_unify_chat_sessions_scope',
  '072_drop_chat_sessions_project_fk',
  '073_add_agent_lib_to_chat_sessions',
  '074_drop_legacy_items_logs_tables',
  '075_rename_project_chat_sessions_to_chat_sessions',
  '076_add_source_to_chat_sessions',
  '077_rename_agent_type_implementor',
  '078_role_based_agent_types',
  '079_force_default_pipeline_agent',
  '080_consolidate_to_single_pipeline',
  '081_reseed_pipelines_request_changes',
  '082_add_addressed_to_context_entries',
  '083_migrate_plan_design_comments_to_context_entries',
  '084_create_app_debug_log',
  '085_add_debug_info_column',
  '086_create_automated_agents',
  '087_drop_agent_runs_task_fk',
  '098_add_created_by_to_tasks',
  '102_reseed_pipelines_backlog_status',
  '103_add_cache_tokens_and_cost_usd_to_agent_runs',
  '104_add_cache_tokens_and_cost_usd_to_chat_messages',
  '105_reseed_pipelines_status_colors',
  '106_add_sidebar_hidden_to_chat_sessions',
  '107_add_last_context_input_tokens_to_chat_messages',
  '108_add_task_ids_to_chat_sessions',
  '109_add_system_prompt_append_to_chat_sessions',
  '110_reseed_pipelines_already_on_main',
  '111_add_diagnostics_to_agent_runs',
  '118_add_investigation_report_to_tasks',
  '119_add_post_mortem_to_tasks',
  '120_backfill_post_mortem_from_context_entries',
];

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

function getPipelineSeedSql(now: number): string {
  return SEEDED_PIPELINES.map((p) => {
    const id = escSql(p.id);
    const name = escSql(p.name);
    const desc = escSql(p.description);
    const taskType = escSql(p.taskType);
    const statuses = escSql(JSON.stringify(p.statuses));
    const transitions = escSql(JSON.stringify(p.transitions));
    return `INSERT OR IGNORE INTO pipelines (id, name, description, statuses, transitions, task_type, created_at, updated_at) VALUES ('${id}', '${name}', '${desc}', '${statuses}', '${transitions}', '${taskType}', ${now}, ${now})`;
  }).join(';\n');
}

function getAgentDefinitionsSeedSql(now: number): string {
  const builtInAgents = [
    { id: 'agent-def-implementor', name: 'Implementor', description: 'Implements code changes and addresses review feedback',
      engine: 'claude-code', modes: [{ mode: 'new', promptTemplate: '' }, { mode: 'revision', promptTemplate: '' }] },
    { id: 'agent-def-task-workflow-reviewer', name: 'Workflow Reviewer', description: 'Reviews completed task execution end-to-end',
      engine: 'claude-code', modes: [{ mode: 'new', promptTemplate: '' }] },
    { id: 'agent-def-post-mortem-reviewer', name: 'Post-Mortem Reviewer', description: 'Analyses defective tasks to find root causes and suggest workflow improvements',
      engine: 'claude-code', modes: [{ mode: 'new', promptTemplate: '' }] },
    { id: 'agent-def-planner', name: 'Planner', description: 'Creates and revises implementation plans',
      engine: 'claude-code', modes: [{ mode: 'new', promptTemplate: '' }, { mode: 'revision', promptTemplate: '' }] },
    { id: 'agent-def-designer', name: 'Designer', description: 'Creates and revises technical designs',
      engine: 'claude-code', modes: [{ mode: 'new', promptTemplate: '' }, { mode: 'revision', promptTemplate: '' }] },
    { id: 'agent-def-investigator', name: 'Investigator', description: 'Investigates bugs and issues',
      engine: 'claude-code', modes: [{ mode: 'new', promptTemplate: '' }, { mode: 'revision', promptTemplate: '' }] },
    { id: 'agent-def-reviewer', name: 'Reviewer', description: 'Reviews code changes and provides feedback',
      engine: 'claude-code', modes: [{ mode: 'new', promptTemplate: '' }] },
  ];

  const externalAgents = [
    { id: 'agent-def-cursor-agent', name: 'Cursor Agent', description: 'Agent powered by Cursor CLI', engine: 'cursor-agent' },
    { id: 'agent-def-codex-cli', name: 'Codex CLI Agent', description: 'Agent powered by OpenAI Codex CLI', engine: 'codex-cli' },
  ];

  const stmts: string[] = [];
  for (const a of builtInAgents) {
    const modes = escSql(JSON.stringify(a.modes));
    stmts.push(
      `INSERT OR IGNORE INTO agent_definitions (id, name, description, engine, modes, is_built_in, created_at, updated_at) VALUES ('${a.id}', '${escSql(a.name)}', '${escSql(a.description)}', '${a.engine}', '${modes}', 1, ${now}, ${now})`,
    );
  }
  for (const a of externalAgents) {
    stmts.push(
      `INSERT OR IGNORE INTO agent_definitions (id, name, description, engine, modes, is_built_in, created_at, updated_at) VALUES ('${a.id}', '${escSql(a.name)}', '${escSql(a.description)}', '${a.engine}', '[]', 0, ${now}, ${now})`,
    );
  }
  return stmts.join(';\n');
}

/**
 * Returns the complete baseline DDL + seed data SQL for a fresh database.
 * Tables are ordered by foreign-key dependency (parents before children).
 */
export function getBaselineSchema(): string {
  const now = Date.now();
  return `
-- =============================================
-- Baseline schema (replaces migrations 001–087, 098)
-- =============================================

-- ====== Core tables ======

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  statuses TEXT NOT NULL,
  transitions TEXT NOT NULL,
  task_type TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  path TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

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
  subtasks TEXT NOT NULL DEFAULT '[]',
  plan TEXT, -- DEPRECATED: use task_docs table instead. No longer actively written.
  investigation_report TEXT, -- DEPRECATED: use task_docs table instead. No longer actively written.
  feature_id TEXT REFERENCES features(id),
  plan_comments TEXT NOT NULL DEFAULT '[]',
  technical_design TEXT, -- DEPRECATED: use task_docs table instead. No longer actively written.
  technical_design_comments TEXT NOT NULL DEFAULT '[]',
  post_mortem TEXT,
  phases TEXT,
  debug_info TEXT,
  created_by TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (pipeline_id) REFERENCES pipelines(id),
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
);

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
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  project_id TEXT
);

-- ====== Agent system ======

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','timed_out','cancelled')),
  output TEXT,
  outcome TEXT,
  payload TEXT,
  prompt TEXT,
  exit_code INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  cost_input_tokens INTEGER,
  cost_output_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  total_cost_usd REAL,
  error TEXT,
  timeout_ms INTEGER,
  max_turns INTEGER,
  message_count INTEGER,
  messages TEXT,
  automated_agent_id TEXT,
  diagnostics TEXT
);

CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('branch','pr','commit','diff','document')),
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS task_phases (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','active','completed','failed')),
  agent_run_id TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY(task_id) REFERENCES tasks(id),
  FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id)
);

CREATE TABLE IF NOT EXISTS pending_prompts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL,
  prompt_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  response TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','answered','expired')),
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  resume_outcome TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id),
  FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id)
);

CREATE TABLE IF NOT EXISTS task_context_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_run_id TEXT,
  source TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  addressed INTEGER NOT NULL DEFAULT 0,
  addressed_by_run_id TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS agent_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  engine TEXT NOT NULL,
  model TEXT,
  modes TEXT NOT NULL DEFAULT '[]',
  system_prompt TEXT,
  timeout INTEGER,
  is_built_in INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]'
);

-- ====== Chat system ======

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'project',
  scope_id TEXT NOT NULL DEFAULT '',
  agent_lib TEXT,
  source TEXT NOT NULL DEFAULT 'desktop',
  sidebar_hidden INTEGER NOT NULL DEFAULT 0,
  system_prompt_append TEXT DEFAULT NULL,
  task_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cost_input_tokens INTEGER,
  cost_output_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  total_cost_usd REAL,
  last_context_input_tokens INTEGER DEFAULT NULL
);

-- ====== UI / boards ======

CREATE TABLE IF NOT EXISTS kanban_boards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  columns TEXT NOT NULL DEFAULT '[]',
  filters TEXT NOT NULL DEFAULT '{}',
  sort_by TEXT NOT NULL DEFAULT 'manual',
  sort_direction TEXT NOT NULL DEFAULT 'asc',
  card_height TEXT NOT NULL DEFAULT 'normal',
  show_subtasks INTEGER NOT NULL DEFAULT 1,
  show_assignee INTEGER NOT NULL DEFAULT 1,
  show_tags INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ====== Users ======

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ====== Debug / observability ======

CREATE TABLE IF NOT EXISTS app_debug_log (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

-- ====== Task docs (unified document artifacts) ======

CREATE TABLE IF NOT EXISTS task_docs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(task_id, type)
);

-- ====== Automated agents ======

CREATE TABLE IF NOT EXISTS automated_agents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  prompt_instructions TEXT NOT NULL DEFAULT '',
  capabilities TEXT NOT NULL DEFAULT '{}',
  schedule TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  max_run_duration_ms INTEGER NOT NULL DEFAULT 600000,
  template_id TEXT,
  last_run_at INTEGER,
  last_run_status TEXT,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ====== Indexes ======

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_pipeline_id ON tasks(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_feature_id ON tasks(feature_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_transition_history_task_id ON transition_history(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_category ON task_events(category);
CREATE INDEX IF NOT EXISTS idx_task_events_created_at ON task_events(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_project_id ON activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_task_type ON pipelines(task_type);
CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_auto_agent ON agent_runs(automated_agent_id);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_id ON task_artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_task_phases_task_id ON task_phases(task_id);
CREATE INDEX IF NOT EXISTS idx_pending_prompts_task_id ON pending_prompts(task_id);
CREATE INDEX IF NOT EXISTS idx_pending_prompts_status ON pending_prompts(status);
CREATE INDEX IF NOT EXISTS idx_task_context_task_id ON task_context_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_features_project_id ON features(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_scope ON chat_sessions(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kanban_boards_project_id ON kanban_boards(project_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_app_debug_log_level ON app_debug_log(level);
CREATE INDEX IF NOT EXISTS idx_app_debug_log_source ON app_debug_log(source);
CREATE INDEX IF NOT EXISTS idx_app_debug_log_created_at ON app_debug_log(created_at);
CREATE INDEX IF NOT EXISTS idx_automated_agents_project ON automated_agents(project_id);
CREATE INDEX IF NOT EXISTS idx_automated_agents_schedule ON automated_agents(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_task_docs_task ON task_docs(task_id);

-- ====== Seed data ======

INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'system');
INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_enabled', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('chat_default_agent_lib', 'claude-code');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_pipeline_id', 'pipeline-agent');

${getPipelineSeedSql(now)};

${getAgentDefinitionsSeedSql(now)};

INSERT OR IGNORE INTO users (id, username, role, created_at, updated_at) VALUES ('user-admin', 'admin', 'admin', ${now}, ${now});
`;
}
