import Database from 'better-sqlite3';
import type { IProjectStore } from '../../src/core/interfaces/project-store';
import type { IPipelineStore } from '../../src/core/interfaces/pipeline-store';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { ITaskEventLog } from '../../src/core/interfaces/task-event-log';
import type { IActivityLog } from '../../src/core/interfaces/activity-log';
import type { IPipelineEngine as _IPipelineEngine } from '../../src/core/interfaces/pipeline-engine';
import type { IAgentRunStore } from '../../src/core/interfaces/agent-run-store';
import type { ITaskArtifactStore } from '../../src/core/interfaces/task-artifact-store';
import type { ITaskPhaseStore } from '../../src/core/interfaces/task-phase-store';
import type { IPendingPromptStore } from '../../src/core/interfaces/pending-prompt-store';
import type { IWorktreeManager } from '../../src/core/interfaces/worktree-manager';
import type { IGitOps } from '../../src/core/interfaces/git-ops';
import type { IScmPlatform } from '../../src/core/interfaces/scm-platform';
import type { IFeatureStore } from '../../src/core/interfaces/feature-store';
import type { IAgentDefinitionStore } from '../../src/core/interfaces/agent-definition-store';
import type { ITaskContextStore } from '../../src/core/interfaces/task-context-store';
import { SqliteProjectStore } from '../../src/core/stores/sqlite-project-store';
import { SqlitePipelineStore } from '../../src/core/stores/sqlite-pipeline-store';
import { SqliteTaskStore } from '../../src/core/stores/sqlite-task-store';
import { SqliteTaskEventLog } from '../../src/core/stores/sqlite-task-event-log';
import { SqliteActivityLog } from '../../src/core/stores/sqlite-activity-log';
import { SqliteAgentRunStore } from '../../src/core/stores/sqlite-agent-run-store';
import { SqliteUserStore } from '../../src/core/stores/sqlite-user-store';
import { SqliteTransactionRunner } from '../../src/core/stores/sqlite-transaction-runner';
import { SqliteTaskArtifactStore } from '../../src/core/stores/sqlite-task-artifact-store';
import { SqliteTaskPhaseStore } from '../../src/core/stores/sqlite-task-phase-store';
import { SqlitePendingPromptStore } from '../../src/core/stores/sqlite-pending-prompt-store';
import { SqliteFeatureStore } from '../../src/core/stores/sqlite-feature-store';
import { SqliteAgentDefinitionStore } from '../../src/core/stores/sqlite-agent-definition-store';
import { SqliteTaskContextStore } from '../../src/core/stores/sqlite-task-context-store';
import { PipelineEngine } from '../../src/core/services/pipeline-engine';
import { AgentFrameworkImpl } from '../../src/core/services/agent-framework-impl';
import { AgentService } from '../../src/core/services/agent-service';
import { WorkflowService } from '../../src/core/services/workflow-service';
import { StubWorktreeManager } from '../../src/core/services/stub-worktree-manager';
import { StubGitOps } from '../../src/core/services/stub-git-ops';
import { StubScmPlatform } from '../../src/core/services/stub-scm-platform';
import { StubNotificationRouter } from '../../src/core/services/stub-notification-router';
import { ValidationRunner } from '../../src/core/services/validation-runner';
import { OutcomeResolver } from '../../src/core/services/outcome-resolver';
import { registerCoreGuards } from '../../src/core/handlers/core-guards';
import { registerScmHandler } from '../../src/core/handlers/scm-handler';
import { registerPromptHandler } from '../../src/core/handlers/prompt-handler';
import { registerNotificationHandler } from '../../src/core/handlers/notification-handler';
import { registerPhaseHandler } from '../../src/core/handlers/phase-handler';
import { ScriptedAgent, happyPlan } from '../../src/core/agents/scripted-agent';
import { getBaselineSchema, BASELINE_MIGRATION_NAMES } from '../../src/core/schema';
import { getMigrations } from '../../src/core/migrations';
import { resetCounters, createTaskInput } from './factories';
import type { Task, TaskCreateInput, Transition } from '../../src/shared/types';

export interface TransitionHistoryRow {
  id: string;
  task_id: string;
  from_status: string;
  to_status: string;
  trigger: string;
  actor: string | null;
  guard_results: string;
  created_at: number;
}

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
  outcomeResolver: OutcomeResolver;
  // Phase 3
  featureStore: IFeatureStore;
  agentDefinitionStore: IAgentDefinitionStore;
  taskContextStore: ITaskContextStore;
  transitionTo: (taskId: string, toStatus: string) => Promise<Task>;
  createTaskAtStatus: (projectId: string, pipelineId: string, targetStatus: string, overrides?: Partial<TaskCreateInput>) => Promise<Task>;
  getTransitionHistory: (taskId: string) => TransitionHistoryRow[];
  cleanup: () => void;
}

export function applyMigrations(db: Database.Database): void {
  // Create migrations tracking table (same as production database.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Apply baseline schema and record migration names (mirrors production db.ts)
  db.exec(getBaselineSchema());
  const insertMigration = db.prepare('INSERT INTO migrations (name) VALUES (?)');
  for (const name of BASELINE_MIGRATION_NAMES) {
    insertMigration.run(name);
  }
  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as { name: string }[]).map(r => r.name),
  );
  for (const m of getMigrations()) {
    if (!applied.has(m.name)) {
      db.exec(m.sql);
      insertMigration.run(m.name);
    }
  }
}

export function createTestContext(): TestContext {
  resetCounters();

  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Apply migrations before enabling foreign keys to avoid issues
  // with DROP TABLE statements in migration sequences
  applyMigrations(db);

  db.pragma('foreign_keys = ON');

  // Phase 1 stores
  const projectStore = new SqliteProjectStore(db);
  const pipelineStore = new SqlitePipelineStore(db);
  const taskStore = new SqliteTaskStore(db, pipelineStore);
  const taskEventLog = new SqliteTaskEventLog(db);
  const activityLog = new SqliteActivityLog(db);
  const agentRunStore = new SqliteAgentRunStore(db);
  const userStore = new SqliteUserStore(db);
  const txRunner = new SqliteTransactionRunner(db);
  const guardContext: import('../../src/shared/types').IGuardQueryContext = {
    countUnresolvedDependencies: (id: string) => taskStore.countUnresolvedDependenciesSync(id),
    countFailedRuns: (id: string, agentType?: string) => agentRunStore.countFailedRunsSync(id, agentType),
    countRunningRuns: (id: string) => agentRunStore.countRunningRunsSync(id),
    countSelfLoopTransitions: (id: string, fromStatus: string, toStatus: string) => pipelineStore.countSelfLoopTransitionsSync(id, fromStatus, toStatus),
    getUserRole: (username: string) => userStore.getUserRoleSync(username),
  };
  const pipelineEngine = new PipelineEngine(pipelineStore, taskStore, taskEventLog, txRunner, guardContext);

  // Register built-in guards (same as production setup.ts)
  registerCoreGuards(pipelineEngine);

  // Phase 2 stores
  // agentRunStore is created above (needed for guardContext)
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
  agentFramework.registerAgent(new ScriptedAgent(happyPlan, 'planner'));
  agentFramework.registerAgent(new ScriptedAgent(happyPlan, 'designer'));
  agentFramework.registerAgent(new ScriptedAgent(happyPlan, 'implementor'));
  agentFramework.registerAgent(new ScriptedAgent(happyPlan, 'investigator'));
  agentFramework.registerAgent(new ScriptedAgent(happyPlan, 'reviewer'));
  agentFramework.registerAgent(new ScriptedAgent(happyPlan, 'task-workflow-reviewer'));

  // Validation runner + outcome resolver for agent post-processing
  const validationRunner = new ValidationRunner(agentRunStore, taskEventLog);
  const outcomeResolver = new OutcomeResolver(
    () => gitOps, pipelineEngine, taskStore,
    taskPhaseStore, taskArtifactStore, taskEventLog,
    agentRunStore,
  );

  // Agent service (pass factory functions that return the shared stubs)
  const agentService = new AgentService(
    agentFramework, agentRunStore,
    () => worktreeManager,
    taskStore, projectStore,
    taskEventLog, taskPhaseStore, pendingPromptStore,
    () => gitOps,
    taskContextStore, agentDefinitionStore,
    undefined, notificationRouter,
    validationRunner, outcomeResolver,
  );

  // Workflow service
  const workflowService = new WorkflowService(
    taskStore, projectStore, pipelineEngine, pipelineStore,
    taskEventLog, activityLog, agentRunStore, pendingPromptStore,
    taskArtifactStore, agentService,
    () => scmPlatform,
    () => worktreeManager,
    () => gitOps,
    taskContextStore,
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
  registerNotificationHandler(pipelineEngine, { notificationRouter, taskStore });
  // NOTE: registerAgentHandler is intentionally NOT called here.
  // The start_agent hook fires background agents during transitions,
  // which causes race conditions with test-controlled agents.
  // Tests that need start_agent behavior register their own stub (e.g. phase-cycling).
  registerPhaseHandler(pipelineEngine, {
    taskStore, taskArtifactStore, taskEventLog, pipelineEngine,
    projectStore, createScmPlatform: () => scmPlatform,
  });

  const transitionTo = async (taskId: string, toStatus: string): Promise<Task> => {
    const task = await taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const result = await pipelineEngine.executeTransition(task, toStatus, { trigger: 'manual' });
    if (!result.success) {
      const reason = result.guardFailures?.map(g => `${g.guard}: ${g.reason}`).join(', ') || result.error || 'unknown';
      throw new Error(`Transition to '${toStatus}' failed: ${reason}`);
    }
    return result.task!;
  };

  const createTaskAtStatus = async (
    projectId: string,
    pipelineId: string,
    targetStatus: string,
    overrides?: Partial<TaskCreateInput>,
  ): Promise<Task> => {
    const task = await taskStore.createTask(createTaskInput(projectId, pipelineId, overrides));
    const initialStatus = task.status;

    if (initialStatus === targetStatus) {
      return task;
    }

    // Get pipeline to find transitions
    const pipeline = await pipelineStore.getPipeline(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

    const transitions = pipeline.transitions as Transition[];

    // BFS to find shortest path of manual transitions from initialStatus to targetStatus
    const queue: Array<{ status: string; path: string[] }> = [{ status: initialStatus, path: [] }];
    const visited = new Set<string>([initialStatus]);

    let pathToTarget: string[] | null = null;

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const t of transitions) {
        if (t.from === current.status && t.trigger === 'manual' && !visited.has(t.to)) {
          const newPath = [...current.path, t.to];
          if (t.to === targetStatus) {
            pathToTarget = newPath;
            break;
          }
          visited.add(t.to);
          queue.push({ status: t.to, path: newPath });
        }
      }

      if (pathToTarget) break;
    }

    if (!pathToTarget) {
      throw new Error(`No manual transition path from '${initialStatus}' to '${targetStatus}' in pipeline '${pipelineId}'`);
    }

    // Execute each transition in the path
    const currentTaskId = task.id;
    for (const nextStatus of pathToTarget) {
      await transitionTo(currentTaskId, nextStatus);
    }

    const finalTask = await taskStore.getTask(currentTaskId);
    if (!finalTask) throw new Error(`Task not found after transitions: ${currentTaskId}`);
    return finalTask;
  };

  const getTransitionHistory = (taskId: string): TransitionHistoryRow[] => {
    return db.prepare('SELECT * FROM transition_history WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as TransitionHistoryRow[];
  };

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
    outcomeResolver,
    featureStore,
    agentDefinitionStore,
    taskContextStore,
    transitionTo,
    createTaskAtStatus,
    getTransitionHistory,
    cleanup: () => db.close(),
  };
}
