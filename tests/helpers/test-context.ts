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
import { getMigrations } from '../../src/main/migrations';
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
  // Phase 3
  featureStore: IFeatureStore;
  agentDefinitionStore: IAgentDefinitionStore;
  taskContextStore: ITaskContextStore;
  transitionTo: (taskId: string, toStatus: string) => Promise<Task>;
  createTaskAtStatus: (projectId: string, pipelineId: string, targetStatus: string, overrides?: Partial<TaskCreateInput>) => Promise<Task>;
  getTransitionHistory: (taskId: string) => TransitionHistoryRow[];
  cleanup: () => void;
}

function applyMigrations(db: Database.Database): void {
  // Create migrations tracking table (same as production database.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Run all production migrations in order
  const migrations = getMigrations();
  for (const m of migrations) {
    db.exec(m.sql);
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
    undefined, // createGitOps
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
  registerNotificationHandler(pipelineEngine, { notificationRouter });

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
    featureStore,
    agentDefinitionStore,
    taskContextStore,
    transitionTo,
    createTaskAtStatus,
    getTransitionHistory,
    cleanup: () => db.close(),
  };
}
