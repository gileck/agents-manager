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
import { SqliteProjectStore } from '../stores/sqlite-project-store';
import { SqlitePipelineStore } from '../stores/sqlite-pipeline-store';
import { SqliteTaskStore } from '../stores/sqlite-task-store';
import { SqliteTaskEventLog } from '../stores/sqlite-task-event-log';
import { SqliteActivityLog } from '../stores/sqlite-activity-log';
import { SqliteAgentRunStore } from '../stores/sqlite-agent-run-store';
import { SqliteTaskArtifactStore } from '../stores/sqlite-task-artifact-store';
import { SqliteTaskPhaseStore } from '../stores/sqlite-task-phase-store';
import { SqlitePendingPromptStore } from '../stores/sqlite-pending-prompt-store';
import { PipelineEngine } from '../services/pipeline-engine';
import { AgentFrameworkImpl } from '../services/agent-framework-impl';
import { AgentService } from '../services/agent-service';
import { WorkflowService } from '../services/workflow-service';
import { LocalGitOps } from '../services/local-git-ops';
import { LocalWorktreeManager } from '../services/local-worktree-manager';
import { GitHubScmPlatform } from '../services/github-scm-platform';
import { DesktopNotificationRouter } from '../services/desktop-notification-router';
import { ScriptedAgent, happyPlan } from '../agents/scripted-agent';
import { ClaudeCodeAgent } from '../agents/claude-code-agent';
import { registerCoreGuards } from '../handlers/core-guards';
import { registerAgentHandler } from '../handlers/agent-handler';
import { registerNotificationHandler } from '../handlers/notification-handler';

export interface AppServices {
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

  // Phase 2 infrastructure — factory functions create project-scoped instances
  const createGitOps = (cwd: string) => new LocalGitOps(cwd);
  const createWorktreeManager = (path: string) => new LocalWorktreeManager(path);
  const createScmPlatform = (path: string) => new GitHubScmPlatform(path);
  const notificationRouter = new DesktopNotificationRouter();

  // Agent framework + adapters
  const agentFramework = new AgentFrameworkImpl();
  agentFramework.registerAgent(new ClaudeCodeAgent());
  agentFramework.registerAgent(new ScriptedAgent(happyPlan));

  // Agent service
  const agentService = new AgentService(
    agentFramework, agentRunStore, createWorktreeManager,
    createGitOps, createScmPlatform, taskStore, projectStore, pipelineEngine,
    taskEventLog, taskArtifactStore, taskPhaseStore, pendingPromptStore,
  );

  // Workflow service
  const workflowService = new WorkflowService(
    taskStore, projectStore, pipelineEngine, pipelineStore,
    taskEventLog, activityLog, agentRunStore, pendingPromptStore,
    taskArtifactStore, agentService, createScmPlatform,
  );

  // Register hooks (must be after workflowService is created)
  registerAgentHandler(pipelineEngine, { workflowService, taskEventLog });
  registerNotificationHandler(pipelineEngine, { notificationRouter });

  return {
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
  };
}
