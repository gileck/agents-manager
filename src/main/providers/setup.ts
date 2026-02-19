import type Database from 'better-sqlite3';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IActivityLog } from '../interfaces/activity-log';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskPhaseStore } from '../interfaces/task-phase-store';
import type { IPendingPromptStore } from '../interfaces/pending-prompt-store';
import type { IAgentFramework } from '../interfaces/agent-framework';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { IAgentService } from '../interfaces/agent-service';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { IFeatureStore } from '../interfaces/feature-store';
import type { IAgentDefinitionStore } from '../interfaces/agent-definition-store';
import { SqliteProjectStore } from '../stores/sqlite-project-store';
import { SqlitePipelineStore } from '../stores/sqlite-pipeline-store';
import { SqliteTaskStore } from '../stores/sqlite-task-store';
import { SqliteTaskEventLog } from '../stores/sqlite-task-event-log';
import { SqliteActivityLog } from '../stores/sqlite-activity-log';
import { SqliteAgentRunStore } from '../stores/sqlite-agent-run-store';
import { SqliteTaskArtifactStore } from '../stores/sqlite-task-artifact-store';
import { SqliteTaskPhaseStore } from '../stores/sqlite-task-phase-store';
import { SqlitePendingPromptStore } from '../stores/sqlite-pending-prompt-store';
import { SqliteTaskContextStore } from '../stores/sqlite-task-context-store';
import { SqliteFeatureStore } from '../stores/sqlite-feature-store';
import { SqliteAgentDefinitionStore } from '../stores/sqlite-agent-definition-store';
import { PipelineEngine } from '../services/pipeline-engine';
import { AgentFrameworkImpl } from '../services/agent-framework-impl';
import { AgentService } from '../services/agent-service';
import { WorkflowService } from '../services/workflow-service';
import { LocalGitOps } from '../services/local-git-ops';
import { LocalWorktreeManager } from '../services/local-worktree-manager';
import { GitHubScmPlatform } from '../services/github-scm-platform';
import { StubNotificationRouter } from '../services/stub-notification-router';
import { ClaudeCodeAgent } from '../agents/claude-code-agent';
import { PrReviewerAgent } from '../agents/pr-reviewer-agent';
import { registerCoreGuards } from '../handlers/core-guards';
import { registerAgentHandler } from '../handlers/agent-handler';
import { registerNotificationHandler } from '../handlers/notification-handler';
import { registerPromptHandler } from '../handlers/prompt-handler';
import { registerScmHandler } from '../handlers/scm-handler';

export interface AppServices {
  db: Database.Database;
  // Phase 1
  projectStore: IProjectStore;
  pipelineStore: IPipelineStore;
  taskStore: ITaskStore;
  taskEventLog: ITaskEventLog;
  activityLog: IActivityLog;
  pipelineEngine: IPipelineEngine;
  // Phase 2
  agentRunStore: IAgentRunStore;
  taskArtifactStore: ITaskArtifactStore;
  taskPhaseStore: ITaskPhaseStore;
  pendingPromptStore: IPendingPromptStore;
  agentFramework: IAgentFramework;
  notificationRouter: INotificationRouter;
  agentService: IAgentService;
  workflowService: IWorkflowService;
  taskContextStore: ITaskContextStore;
  featureStore: IFeatureStore;
  agentDefinitionStore: IAgentDefinitionStore;
  createWorktreeManager: (path: string) => IWorktreeManager;
}

export function createAppServices(db: Database.Database): AppServices {
  // Phase 1 stores
  const projectStore = new SqliteProjectStore(db);
  const pipelineStore = new SqlitePipelineStore(db);
  const taskStore = new SqliteTaskStore(db, pipelineStore);
  const taskEventLog = new SqliteTaskEventLog(db);
  const activityLog = new SqliteActivityLog(db);
  const pipelineEngine = new PipelineEngine(pipelineStore, taskStore, taskEventLog, db);

  // Register built-in guards
  registerCoreGuards(pipelineEngine, db);

  // Phase 2 stores
  const agentRunStore = new SqliteAgentRunStore(db);
  const taskArtifactStore = new SqliteTaskArtifactStore(db);
  const taskPhaseStore = new SqliteTaskPhaseStore(db);
  const pendingPromptStore = new SqlitePendingPromptStore(db);
  const taskContextStore = new SqliteTaskContextStore(db);
  const featureStore = new SqliteFeatureStore(db);
  const agentDefinitionStore = new SqliteAgentDefinitionStore(db);

  // Phase 2 infrastructure — factory functions create project-scoped instances
  const createGitOps = (cwd: string) => new LocalGitOps(cwd);
  const createWorktreeManager = (path: string) => new LocalWorktreeManager(path);
  const createScmPlatform = (path: string) => new GitHubScmPlatform(path);
  let notificationRouter: INotificationRouter;
  try {
    const { DesktopNotificationRouter } = require('../services/desktop-notification-router');
    notificationRouter = new DesktopNotificationRouter();
  } catch {
    notificationRouter = new StubNotificationRouter();
  }

  // Agent framework + adapters
  const agentFramework = new AgentFrameworkImpl();
  agentFramework.registerAgent(new ClaudeCodeAgent());
  agentFramework.registerAgent(new PrReviewerAgent());

  // Agent service
  const agentService = new AgentService(
    agentFramework, agentRunStore, createWorktreeManager,
    taskStore, projectStore, pipelineEngine,
    taskEventLog, taskArtifactStore, taskPhaseStore, pendingPromptStore,
    createGitOps, taskContextStore, agentDefinitionStore,
  );

  // Workflow service
  const workflowService = new WorkflowService(
    taskStore, projectStore, pipelineEngine, pipelineStore,
    taskEventLog, activityLog, agentRunStore, pendingPromptStore,
    taskArtifactStore, agentService, createScmPlatform, createWorktreeManager,
  );

  // Register hooks (must be after workflowService is created)
  registerAgentHandler(pipelineEngine, { workflowService, taskEventLog });
  registerNotificationHandler(pipelineEngine, { notificationRouter });
  registerPromptHandler(pipelineEngine, { pendingPromptStore, taskEventLog });
  registerScmHandler(pipelineEngine, {
    projectStore, taskStore, taskArtifactStore, taskEventLog,
    createWorktreeManager, createGitOps, createScmPlatform,
  });

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
    notificationRouter,
    agentService,
    workflowService,
    taskContextStore,
    featureStore,
    agentDefinitionStore,
    createWorktreeManager,
  };
}
