import Database from 'better-sqlite3';
import type { IProjectStore } from '../../src/main/interfaces/project-store';
import type { IPipelineStore } from '../../src/main/interfaces/pipeline-store';
import type { ITaskStore } from '../../src/main/interfaces/task-store';
import type { ITaskEventLog } from '../../src/main/interfaces/task-event-log';
import type { IActivityLog } from '../../src/main/interfaces/activity-log';
import type { IPipelineEngine as _IPipelineEngine } from '../../src/main/interfaces/pipeline-engine';
import type { IAgentRunStore } from '../../src/main/interfaces/agent-run-store';
import type { ITaskArtifactStore } from '../../src/main/interfaces/task-artifact-store';
import type { ITaskPhaseStore } from '../../src/main/interfaces/task-phase-store';
import type { IPendingPromptStore } from '../../src/main/interfaces/pending-prompt-store';
import type { IWorktreeManager } from '../../src/main/interfaces/worktree-manager';
import type { IGitOps } from '../../src/main/interfaces/git-ops';
import type { IScmPlatform } from '../../src/main/interfaces/scm-platform';
import type { IFeatureStore } from '../../src/main/interfaces/feature-store';
import type { IAgentDefinitionStore } from '../../src/main/interfaces/agent-definition-store';
import type { ITaskContextStore } from '../../src/main/interfaces/task-context-store';
import { SqliteProjectStore } from '../../src/main/stores/sqlite-project-store';
import { SqlitePipelineStore } from '../../src/main/stores/sqlite-pipeline-store';
import { SqliteTaskStore } from '../../src/main/stores/sqlite-task-store';
import { SqliteTaskEventLog } from '../../src/main/stores/sqlite-task-event-log';
import { SqliteActivityLog } from '../../src/main/stores/sqlite-activity-log';
import { SqliteAgentRunStore } from '../../src/main/stores/sqlite-agent-run-store';
import { SqliteTaskArtifactStore } from '../../src/main/stores/sqlite-task-artifact-store';
import { SqliteTaskPhaseStore } from '../../src/main/stores/sqlite-task-phase-store';
import { SqlitePendingPromptStore } from '../../src/main/stores/sqlite-pending-prompt-store';
import { SqliteFeatureStore } from '../../src/main/stores/sqlite-feature-store';
import { SqliteAgentDefinitionStore } from '../../src/main/stores/sqlite-agent-definition-store';
import { SqliteTaskContextStore } from '../../src/main/stores/sqlite-task-context-store';
import { PipelineEngine } from '../../src/main/services/pipeline-engine';
import { AgentFrameworkImpl } from '../../src/main/services/agent-framework-impl';
import { AgentService } from '../../src/main/services/agent-service';
import { WorkflowService } from '../../src/main/services/workflow-service';
import { StubWorktreeManager } from '../../src/main/services/stub-worktree-manager';
import { StubGitOps } from '../../src/main/services/stub-git-ops';
import { StubScmPlatform } from '../../src/main/services/stub-scm-platform';
import { StubNotificationRouter } from '../../src/main/services/stub-notification-router';
import { registerCoreGuards } from '../../src/main/handlers/core-guards';
import { registerScmHandler } from '../../src/main/handlers/scm-handler';
import { registerPromptHandler } from '../../src/main/handlers/prompt-handler';
import { registerNotificationHandler } from '../../src/main/handlers/notification-handler';
import { ScriptedAgent, happyPlan } from '../../src/main/agents/scripted-agent';
import { SEEDED_PIPELINES } from '../../src/main/data/seeded-pipelines';
import type { Task } from '../../src/shared/types';

export interface TestContext {
  db: Database.Database;
  // Phase 1
  projectStore: IProjectStore;
  pipelineStore: IPipelineStore;
  taskStore: ITaskStore;
  taskEventLog: ITaskEventLog;
  activityLog: IActivityLog;
  pipelineEngine: PipelineEngine;
  // Phase 2
  agentRunStore: IAgentRunStore;
  taskArtifactStore: ITaskArtifactStore;
  taskPhaseStore: ITaskPhaseStore;
  pendingPromptStore: IPendingPromptStore;
  agentFramework: AgentFrameworkImpl;
  scriptedAgent: ScriptedAgent;
  worktreeManager: IWorktreeManager;
  gitOps: IGitOps;
  scmPlatform: IScmPlatform;
  notificationRouter: StubNotificationRouter;
  agentService: AgentService;
  workflowService: WorkflowService;
  // Phase 3
  featureStore: IFeatureStore;
  agentDefinitionStore: IAgentDefinitionStore;
  taskContextStore: ITaskContextStore;
  transitionTo: (taskId: string, toStatus: string) => Promise<Task>;
  cleanup: () => void;
}

function applyMigrations(db: Database.Database): void {
  // Create migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Template tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('theme', 'system'),
      ('notifications_enabled', 'true')
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL
    )
  `);

  // Phase 1 tables
  db.exec(`
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
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      path TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.exec(`
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
      feature_id TEXT REFERENCES features(id),
      assignee TEXT,
      pr_link TEXT,
      branch_name TEXT,
      plan TEXT,
      technical_design TEXT,
      subtasks TEXT NOT NULL DEFAULT '[]',
      plan_comments TEXT NOT NULL DEFAULT '[]',
      technical_design_comments TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (pipeline_id) REFERENCES pipelines(id),
      FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
    )
  `);

  db.exec(`
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
  `);

  db.exec(`
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
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      project_id TEXT,
      summary TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )
  `);

  // Phase 2 tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('plan','implement','review','request_changes','plan_revision','investigate','resolve_conflicts')),
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
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('branch','pr','commit','diff','document')),
      data TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    )
  `);

  db.exec(`
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
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_prompts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      prompt_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      response TEXT,
      resume_outcome TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending','answered','expired')),
      created_at INTEGER NOT NULL,
      answered_at INTEGER,
      FOREIGN KEY(task_id) REFERENCES tasks(id),
      FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id)
    )
  `);

  // Phase 3 tables
  db.exec(`
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
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      engine TEXT NOT NULL,
      model TEXT,
      modes TEXT NOT NULL DEFAULT '[]',
      system_prompt TEXT,
      timeout INTEGER,
      skills TEXT NOT NULL DEFAULT '[]',
      is_built_in INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Seed pipelines
  const now = Date.now();
  const insertPipeline = db.prepare(`
    INSERT OR IGNORE INTO pipelines (id, name, description, statuses, transitions, task_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of SEEDED_PIPELINES) {
    insertPipeline.run(
      p.id,
      p.name,
      p.description,
      JSON.stringify(p.statuses),
      JSON.stringify(p.transitions),
      p.taskType,
      now,
      now,
    );
  }

  // Seed built-in agent definitions
  const insertAgentDef = db.prepare(`
    INSERT OR IGNORE INTO agent_definitions (id, name, description, engine, modes, is_built_in, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);

  insertAgentDef.run(
    'agent-def-claude-code',
    'Implementor',
    'Plans, implements, and fixes code changes',
    'claude-code',
    JSON.stringify([
      { mode: 'plan', promptTemplate: 'Create a plan for: {taskTitle}', timeout: 300000 },
      { mode: 'implement', promptTemplate: 'Implement: {taskTitle}' },
      { mode: 'request_changes', promptTemplate: 'Address review feedback for: {taskTitle}' },
      { mode: 'plan_revision', promptTemplate: 'Revise plan for: {taskTitle}' },
      { mode: 'investigate', promptTemplate: 'Investigate bug: {taskTitle}', timeout: 300000 },
    ]),
    now,
    now,
  );

  insertAgentDef.run(
    'agent-def-pr-reviewer',
    'PR Reviewer',
    'Reviews code changes and provides feedback',
    'claude-code',
    JSON.stringify([
      { mode: 'review', promptTemplate: 'Review changes for: {taskTitle}' },
    ]),
    now,
    now,
  );

  // Indexes (Phase 1 + Phase 2 + Phase 3)
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_pipelines_task_type ON pipelines(task_type);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
    CREATE INDEX IF NOT EXISTS idx_task_artifacts_task_id ON task_artifacts(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_phases_task_id ON task_phases(task_id);
    CREATE INDEX IF NOT EXISTS idx_pending_prompts_task_id ON pending_prompts(task_id);
    CREATE INDEX IF NOT EXISTS idx_pending_prompts_status ON pending_prompts(status);
    CREATE INDEX IF NOT EXISTS idx_features_project_id ON features(project_id);
    CREATE INDEX IF NOT EXISTS idx_task_context_task_id ON task_context_entries(task_id)
  `);
}

export function createTestContext(): TestContext {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  applyMigrations(db);

  // Phase 1 stores
  const projectStore = new SqliteProjectStore(db);
  const pipelineStore = new SqlitePipelineStore(db);
  const taskStore = new SqliteTaskStore(db, pipelineStore);
  const taskEventLog = new SqliteTaskEventLog(db);
  const activityLog = new SqliteActivityLog(db);
  const pipelineEngine = new PipelineEngine(pipelineStore, taskStore, taskEventLog, db);

  // Register built-in guards (same as production setup.ts)
  registerCoreGuards(pipelineEngine, db);

  // Phase 2 stores
  const agentRunStore = new SqliteAgentRunStore(db);
  const taskArtifactStore = new SqliteTaskArtifactStore(db);
  const taskPhaseStore = new SqliteTaskPhaseStore(db);
  const pendingPromptStore = new SqlitePendingPromptStore(db);

  // Phase 3 stores
  const featureStore = new SqliteFeatureStore(db);
  const agentDefinitionStore = new SqliteAgentDefinitionStore(db);
  const taskContextStore = new SqliteTaskContextStore(db);

  // Phase 2 infrastructure (stubs)
  const worktreeManager = new StubWorktreeManager();
  const gitOps = new StubGitOps();
  const scmPlatform = new StubScmPlatform();
  const notificationRouter = new StubNotificationRouter();

  // Agent framework + adapters
  const agentFramework = new AgentFrameworkImpl();
  const scriptedAgent = new ScriptedAgent(happyPlan);
  agentFramework.registerAgent(scriptedAgent);
  agentFramework.registerAgent(new ScriptedAgent(happyPlan, 'claude-code'));

  // Agent service (pass factory functions that return the shared stubs)
  const agentService = new AgentService(
    agentFramework, agentRunStore,
    () => worktreeManager,
    taskStore, projectStore, pipelineEngine,
    taskEventLog, taskArtifactStore, taskPhaseStore, pendingPromptStore,
    () => gitOps,
    taskContextStore, agentDefinitionStore,
  );

  // Workflow service
  const workflowService = new WorkflowService(
    taskStore, projectStore, pipelineEngine, pipelineStore,
    taskEventLog, activityLog, agentRunStore, pendingPromptStore,
    taskArtifactStore, agentService,
    () => scmPlatform,
    () => worktreeManager,
  );

  // Register production hooks (scm, prompt, notification)
  registerScmHandler(pipelineEngine, {
    projectStore,
    taskStore,
    taskArtifactStore,
    taskEventLog,
    createWorktreeManager: () => worktreeManager,
    createGitOps: () => gitOps,
    createScmPlatform: () => scmPlatform,
  });
  registerPromptHandler(pipelineEngine, { pendingPromptStore, taskEventLog });
  registerNotificationHandler(pipelineEngine, { notificationRouter });

  return {
    db,
    projectStore,
    pipelineStore,
    taskStore,
    taskEventLog,
    activityLog,
    pipelineEngine,
    agentRunStore,
    taskArtifactStore,
    taskPhaseStore,
    pendingPromptStore,
    agentFramework,
    scriptedAgent,
    worktreeManager,
    gitOps,
    scmPlatform,
    notificationRouter,
    agentService,
    workflowService,
    featureStore,
    agentDefinitionStore,
    taskContextStore,
    transitionTo: async (taskId: string, toStatus: string): Promise<Task> => {
      const task = await taskStore.getTask(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const result = await pipelineEngine.executeTransition(task, toStatus, { trigger: 'manual' });
      if (!result.success) {
        const reason = result.guardFailures?.map(g => `${g.guard}: ${g.reason}`).join(', ') || result.error || 'unknown';
        throw new Error(`Transition to '${toStatus}' failed: ${reason}`);
      }
      return result.task!;
    },
    cleanup: () => db.close(),
  };
}
