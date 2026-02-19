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
    {
      name: '013_create_agent_runs',
      sql: `
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          agent_type TEXT NOT NULL,
          mode TEXT NOT NULL CHECK(mode IN ('plan','implement','review')),
          status TEXT NOT NULL CHECK(status IN ('running','completed','failed','timed_out','cancelled')),
          output TEXT,
          outcome TEXT,
          payload TEXT,
          exit_code INTEGER,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          cost_input_tokens INTEGER,
          cost_output_tokens INTEGER,
          FOREIGN KEY(task_id) REFERENCES tasks(id)
        )
      `,
    },
    {
      name: '014_create_task_artifacts',
      sql: `
        CREATE TABLE IF NOT EXISTS task_artifacts (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('branch','pr','commit','diff','document')),
          data TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          FOREIGN KEY(task_id) REFERENCES tasks(id)
        )
      `,
    },
    {
      name: '015_create_task_phases',
      sql: `
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
        )
      `,
    },
    {
      name: '016_create_pending_prompts',
      sql: `
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
          FOREIGN KEY(task_id) REFERENCES tasks(id),
          FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id)
        )
      `,
    },
    {
      name: '017_create_phase2_indexes',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
        CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_id ON task_artifacts(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_phases_task_id ON task_phases(task_id);
        CREATE INDEX IF NOT EXISTS idx_pending_prompts_task_id ON pending_prompts(task_id);
        CREATE INDEX IF NOT EXISTS idx_pending_prompts_status ON pending_prompts(status)
      `,
    },
    {
      name: '018_update_agent_pipeline_hooks',
      sql: getUpdateAgentPipelineSql(),
    },
    {
      name: '019_add_resume_outcome_to_pending_prompts',
      sql: `ALTER TABLE pending_prompts ADD COLUMN resume_outcome TEXT`,
    },
    {
      name: '020_update_agent_pipeline_hooks_v2',
      sql: getUpdateAgentPipelineSql(),
    },
    {
      name: '021_update_agent_pipeline_retry',
      sql: getUpdateAgentPipelineSql(),
    },
    {
      name: '022_create_task_context_entries',
      sql: `
        CREATE TABLE IF NOT EXISTS task_context_entries (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          agent_run_id TEXT,
          source TEXT NOT NULL,
          entry_type TEXT NOT NULL,
          summary TEXT NOT NULL,
          data TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          FOREIGN KEY(task_id) REFERENCES tasks(id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_context_task_id ON task_context_entries(task_id)
      `,
    },
    {
      name: '023_add_request_changes_mode',
      sql: `
        -- Rebuild agent_runs to widen the mode CHECK constraint.
        -- task_phases and pending_prompts have FKs to agent_runs,
        -- so we must rebuild them too (drop children first, then parent).

        -- 1. Rebuild task_phases without FK to agent_runs
        CREATE TABLE task_phases_tmp (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          phase TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','active','completed','failed')),
          agent_run_id TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY(task_id) REFERENCES tasks(id)
        );
        INSERT INTO task_phases_tmp SELECT * FROM task_phases;
        DROP TABLE task_phases;

        -- 2. Rebuild pending_prompts without FK to agent_runs
        CREATE TABLE pending_prompts_tmp (
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
          FOREIGN KEY(task_id) REFERENCES tasks(id)
        );
        INSERT INTO pending_prompts_tmp SELECT * FROM pending_prompts;
        DROP TABLE pending_prompts;

        -- 3. Now rebuild agent_runs with updated CHECK
        CREATE TABLE agent_runs_new (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          agent_type TEXT NOT NULL,
          mode TEXT NOT NULL CHECK(mode IN ('plan','implement','review','request_changes')),
          status TEXT NOT NULL CHECK(status IN ('running','completed','failed','timed_out','cancelled')),
          output TEXT,
          outcome TEXT,
          payload TEXT,
          exit_code INTEGER,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          cost_input_tokens INTEGER,
          cost_output_tokens INTEGER,
          FOREIGN KEY(task_id) REFERENCES tasks(id)
        );
        INSERT INTO agent_runs_new SELECT * FROM agent_runs;
        DROP TABLE agent_runs;
        ALTER TABLE agent_runs_new RENAME TO agent_runs;

        -- 4. Restore task_phases with FK to new agent_runs
        CREATE TABLE task_phases (
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
        INSERT INTO task_phases SELECT * FROM task_phases_tmp;
        DROP TABLE task_phases_tmp;

        -- 5. Restore pending_prompts with FK to new agent_runs
        CREATE TABLE pending_prompts (
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
        INSERT INTO pending_prompts SELECT * FROM pending_prompts_tmp;
        DROP TABLE pending_prompts_tmp;

        -- 6. Recreate all indexes
        CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
        CREATE INDEX IF NOT EXISTS idx_task_phases_task_id ON task_phases(task_id);
        CREATE INDEX IF NOT EXISTS idx_pending_prompts_task_id ON pending_prompts(task_id);
        CREATE INDEX IF NOT EXISTS idx_pending_prompts_status ON pending_prompts(status)
      `,
    },
    {
      name: '024_add_subtasks_column',
      sql: `ALTER TABLE tasks ADD COLUMN subtasks TEXT NOT NULL DEFAULT '[]'`,
    },
    {
      name: '025_add_plan_column',
      sql: `ALTER TABLE tasks ADD COLUMN plan TEXT`,
    },
    {
      name: '026_create_features',
      sql: `
        CREATE TABLE IF NOT EXISTS features (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );
        CREATE INDEX IF NOT EXISTS idx_features_project_id ON features(project_id)
      `,
    },
    {
      name: '027_add_feature_id_to_tasks',
      sql: `
        ALTER TABLE tasks ADD COLUMN feature_id TEXT REFERENCES features(id);
        CREATE INDEX IF NOT EXISTS idx_tasks_feature_id ON tasks(feature_id)
      `,
    },
    {
      name: '028_create_agent_definitions',
      sql: getSeedAgentDefinitionsSql(),
    },
  ];
}

function getUpdateAgentPipelineSql(): string {
  const agentPipeline = SEEDED_PIPELINES.find((p) => p.id === 'pipeline-agent');
  if (!agentPipeline) return '';
  const transitions = escSql(JSON.stringify(agentPipeline.transitions));
  return `UPDATE pipelines SET transitions = '${transitions}', updated_at = ${Date.now()} WHERE id = 'pipeline-agent'`;
}

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

function getSeedAgentDefinitionsSql(): string {
  const createTable = `
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
      updated_at INTEGER NOT NULL
    )
  `;

  const ts = Date.now();

  const implementorModes = JSON.stringify([
    {
      mode: 'plan',
      promptTemplate: [
        'Analyze this task and create a detailed implementation plan. Task: {taskTitle}.{taskDescription}',
        '',
        '{subtasksSection}',
      ].join('\n'),
      timeout: 300000,
    },
    {
      mode: 'implement',
      promptTemplate: [
        'Implement the changes for this task. After making all changes, stage and commit them with git (git add the relevant files, then git commit with a descriptive message). Task: {taskTitle}.{taskDescription}',
        '{planSection}',
        '{subtasksSection}',
      ].join('\n'),
    },
    {
      mode: 'request_changes',
      promptTemplate: [
        'A code reviewer has reviewed the changes on this branch and requested changes.',
        'You MUST address ALL of the reviewer\'s feedback from the Task Context above.',
        '',
        'Task: {taskTitle}.{taskDescription}',
        '{planSection}',
        '',
        '## Instructions',
        '1. Read the reviewer\'s feedback in the Task Context above carefully.',
        '2. Fix every issue mentioned — do not skip or ignore any feedback.',
        '3. After making all fixes, stage and commit with a descriptive message.',
      ].join('\n'),
    },
  ]);

  const reviewerModes = JSON.stringify([
    {
      mode: 'review',
      promptTemplate: [
        'You are a code reviewer. Review the changes in this branch for the following task: {taskTitle}.{taskDescription}',
        '',
        '{priorReviewSection}',
        'Steps:',
        '1. Run `git diff main..HEAD` to see all changes made in this branch.',
        '2. Review the diff for code quality, correctness, style, and completeness against the task description.',
        '3. Provide a concise review.',
        '4. End your response with a "## Summary" section briefly describing your review findings.',
        '5. End your output with exactly one of these verdicts on its own line:',
        '   REVIEW_VERDICT: APPROVED',
        '   REVIEW_VERDICT: CHANGES_REQUESTED',
        '',
        'If the changes look good, use APPROVED. If there are issues that need fixing, use CHANGES_REQUESTED and explain what needs to change.',
      ].join('\n'),
    },
  ]);

  const seedImplementor = `INSERT OR IGNORE INTO agent_definitions (id, name, description, engine, modes, is_built_in, created_at, updated_at) VALUES ('agent-def-claude-code', 'Implementor', 'Plans, implements, and fixes code changes', 'claude-code', '${escSql(implementorModes)}', 1, ${ts}, ${ts})`;
  const seedReviewer = `INSERT OR IGNORE INTO agent_definitions (id, name, description, engine, modes, is_built_in, created_at, updated_at) VALUES ('agent-def-pr-reviewer', 'PR Reviewer', 'Reviews code changes and provides feedback', 'claude-code', '${escSql(reviewerModes)}', 1, ${ts}, ${ts})`;

  return [createTable, seedImplementor, seedReviewer].join(';\n');
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
