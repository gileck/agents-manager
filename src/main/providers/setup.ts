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
import type { IAgentService } from '../interfaces/agent-service';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { IFeatureStore } from '../interfaces/feature-store';
import type { IAgentDefinitionStore } from '../interfaces/agent-definition-store';
import type { IChatMessageStore } from '../interfaces/chat-message-store';
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
import { SqliteChatMessageStore } from '../stores/sqlite-chat-message-store';
import { PipelineEngine } from '../services/pipeline-engine';
import { AgentFrameworkImpl } from '../services/agent-framework-impl';
import { AgentService } from '../services/agent-service';
import { WorkflowService } from '../services/workflow-service';
import { LocalGitOps } from '../services/local-git-ops';
import { LocalWorktreeManager } from '../services/local-worktree-manager';
import { GitHubScmPlatform } from '../services/github-scm-platform';
import { MultiChannelNotificationRouter } from '../services/multi-channel-notification-router';
import { ClaudeCodeAgent } from '../agents/claude-code-agent';
import { PrReviewerAgent } from '../agents/pr-reviewer-agent';
import { TaskWorkflowReviewerAgent } from '../agents/task-workflow-reviewer-agent';
import { AgentSupervisor } from '../services/agent-supervisor';
import { TaskReviewReportBuilder } from '../services/task-review-report-builder';
import { WorkflowReviewSupervisor } from '../services/workflow-review-supervisor';
import { TimelineService } from '../services/timeline/timeline-service';
import { EventSource } from '../services/timeline/sources/event-source';
import { ActivitySource } from '../services/timeline/sources/activity-source';
import { TransitionSource } from '../services/timeline/sources/transition-source';
import { AgentRunSource } from '../services/timeline/sources/agent-run-source';
import { PhaseSource } from '../services/timeline/sources/phase-source';
import { ArtifactSource } from '../services/timeline/sources/artifact-source';
import { PromptSource } from '../services/timeline/sources/prompt-source';
import { ContextSource } from '../services/timeline/sources/context-source';
import { registerCoreGuards } from '../handlers/core-guards';
import { registerAgentHandler } from '../handlers/agent-handler';
import { registerNotificationHandler } from '../handlers/notification-handler';
import { registerPromptHandler } from '../handlers/prompt-handler';
import { registerScmHandler } from '../handlers/scm-handler';
import { registerPhaseHandler } from '../handlers/phase-handler';
import { ChatAgentService } from '../services/chat-agent-service';

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
  notificationRouter: MultiChannelNotificationRouter;
  agentService: IAgentService;
  workflowService: IWorkflowService;
  taskContextStore: ITaskContextStore;
  featureStore: IFeatureStore;
  agentDefinitionStore: IAgentDefinitionStore;
  createWorktreeManager: (path: string) => IWorktreeManager;
  createGitOps: (cwd: string) => import('../interfaces/git-ops').IGitOps;
  agentSupervisor: AgentSupervisor;
  timelineService: TimelineService;
  workflowReviewSupervisor: WorkflowReviewSupervisor;
  chatMessageStore: IChatMessageStore;
  chatAgentService: ChatAgentService;
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
  const chatMessageStore = new SqliteChatMessageStore(db);

  // Phase 2 infrastructure — factory functions create project-scoped instances
  const createGitOps = (cwd: string) => new LocalGitOps(cwd);
  const createWorktreeManager = (path: string) => new LocalWorktreeManager(path);
  const createScmPlatform = (path: string) => new GitHubScmPlatform(path);
  const notificationRouter = new MultiChannelNotificationRouter();
  try {
    const { DesktopNotificationRouter } = require('../services/desktop-notification-router');
    notificationRouter.addRouter(new DesktopNotificationRouter());
  } catch { /* Not in Electron */ }

  // Timeline service (created before AgentService because TaskReviewReportBuilder needs it)
  const timelineService = new TimelineService([
    new EventSource(db),
    new ActivitySource(db),
    new TransitionSource(db),
    new AgentRunSource(db),
    new PhaseSource(db),
    new ArtifactSource(db),
    new PromptSource(db),
    new ContextSource(db),
  ]);

  // Agent framework + adapters
  const agentFramework = new AgentFrameworkImpl();
  agentFramework.registerAgent(new ClaudeCodeAgent());
  agentFramework.registerAgent(new PrReviewerAgent());
  agentFramework.registerAgent(new TaskWorkflowReviewerAgent());

  // Report builder for workflow reviewer agent
  const taskReviewReportBuilder = new TaskReviewReportBuilder(
    agentRunStore, taskEventLog, taskContextStore,
    taskArtifactStore, taskStore, timelineService,
  );

  // Agent service
  const agentService = new AgentService(
    agentFramework, agentRunStore, createWorktreeManager,
    taskStore, projectStore, pipelineEngine,
    taskEventLog, taskArtifactStore, taskPhaseStore, pendingPromptStore,
    createGitOps, taskContextStore, agentDefinitionStore,
    taskReviewReportBuilder, notificationRouter,
  );

  // Workflow service
  const workflowService = new WorkflowService(
    taskStore, projectStore, pipelineEngine, pipelineStore,
    taskEventLog, activityLog, agentRunStore, pendingPromptStore,
    taskArtifactStore, agentService, createScmPlatform, createWorktreeManager,
    createGitOps, taskContextStore,
  );

  // Supervisor for detecting ghost/timed-out agent runs
  const agentSupervisor = new AgentSupervisor(agentRunStore, agentService, taskEventLog);

  // Supervisor for automatic workflow reviews of completed tasks
  const workflowReviewSupervisor = new WorkflowReviewSupervisor(
    taskStore, taskContextStore, pipelineStore,
    workflowService, agentRunStore, taskEventLog,
  );

  // Chat agent service
  const chatAgentService = new ChatAgentService(chatMessageStore, projectStore);

  // Register hooks (must be after workflowService is created)
  registerAgentHandler(pipelineEngine, { workflowService, taskEventLog });
  registerNotificationHandler(pipelineEngine, { notificationRouter });
  registerPromptHandler(pipelineEngine, { pendingPromptStore, taskEventLog });
  registerScmHandler(pipelineEngine, {
    projectStore, taskStore, taskArtifactStore, taskEventLog,
    createWorktreeManager, createGitOps, createScmPlatform,
  });
  registerPhaseHandler(pipelineEngine, {
    taskStore, taskEventLog, pipelineEngine,
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
    createGitOps,
    agentSupervisor,
    timelineService,
    workflowReviewSupervisor,
    chatMessageStore,
    chatAgentService,
  };
}
