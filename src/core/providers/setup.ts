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
import type { IPipelineInspectionService } from '../interfaces/pipeline-inspection-service';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { IFeatureStore } from '../interfaces/feature-store';
import type { IAgentDefinitionStore } from '../interfaces/agent-definition-store';
import type { IChatMessageStore } from '../interfaces/chat-message-store';
import type { IChatSessionStore } from '../interfaces/chat-session-store';
import type { IKanbanBoardStore } from '../interfaces/kanban-board-store';
import type { ISettingsStore } from '../interfaces/settings-store';
import type { IAppDebugLog } from '../interfaces/app-debug-log';
import type { IAutomatedAgentStore } from '../interfaces/automated-agent-store';
import type { IInAppNotificationStore } from '../interfaces/in-app-notification-store';
import type { IItemStore } from '../interfaces/item-store';
import type { AgentLibRegistry as AgentLibRegistryType } from '../services/agent-lib-registry';
import { SqliteProjectStore } from '../stores/sqlite-project-store';
import { SqlitePipelineStore } from '../stores/sqlite-pipeline-store';
import { SqliteTaskStore } from '../stores/sqlite-task-store';
import { SqliteTaskEventLog } from '../stores/sqlite-task-event-log';
import { SqliteActivityLog } from '../stores/sqlite-activity-log';
import { SqliteAgentRunStore } from '../stores/sqlite-agent-run-store';
import { SqliteUserStore } from '../stores/sqlite-user-store';
import { SqliteTransactionRunner } from '../stores/sqlite-transaction-runner';
import { SqliteTaskArtifactStore } from '../stores/sqlite-task-artifact-store';
import { SqliteTaskPhaseStore } from '../stores/sqlite-task-phase-store';
import { SqlitePendingPromptStore } from '../stores/sqlite-pending-prompt-store';
import { SqliteTaskContextStore } from '../stores/sqlite-task-context-store';
import { SqliteFeatureStore } from '../stores/sqlite-feature-store';
import { SqliteAgentDefinitionStore } from '../stores/sqlite-agent-definition-store';
import { SqliteChatMessageStore } from '../stores/sqlite-chat-message-store';
import { SqliteChatSessionStore } from '../stores/sqlite-chat-session-store';
import { SqliteKanbanBoardStore } from '../stores/sqlite-kanban-board-store';
import { SqliteSettingsStore } from '../stores/settings-store';
import { SqliteAppDebugLog } from '../stores/sqlite-app-debug-log';
import { SqliteAutomatedAgentStore } from '../stores/sqlite-automated-agent-store';
import { SqliteInAppNotificationStore } from '../stores/sqlite-in-app-notification-store';
import { SqliteItemStore } from '../stores/sqlite-item-store';
import { AppLogger, initAppLogger, getAppLogger } from '../services/app-logger';
import { PipelineEngine } from '../services/pipeline-engine';
import { AgentFrameworkImpl } from '../services/agent-framework-impl';
import { AgentService } from '../services/agent-service';
import { WorkflowService } from '../services/workflow-service';
import { PipelineInspectionService } from '../services/pipeline-inspection-service';
import { LocalGitOps } from '../services/local-git-ops';
import { LocalWorktreeManager } from '../services/local-worktree-manager';
import { GitHubScmPlatform } from '../services/github-scm-platform';
import { MultiChannelNotificationRouter } from '../services/multi-channel-notification-router';
import { TelegramNotificationRouter } from '../services/telegram-notification-router';
import { getResolvedConfig } from '../services/config-service';
import { validateTelegramConfig } from '../services/telegram-config-validator';
import { Agent } from '../agents/agent';
import { PlannerPromptBuilder } from '../agents/planner-prompt-builder';
import { DesignerPromptBuilder } from '../agents/designer-prompt-builder';
import { ImplementorPromptBuilder } from '../agents/implementor-prompt-builder';
import { InvestigatorPromptBuilder } from '../agents/investigator-prompt-builder';
import { ReviewerPromptBuilder } from '../agents/reviewer-prompt-builder';
import { TaskWorkflowReviewerPromptBuilder } from '../agents/task-workflow-reviewer-prompt-builder';
import { ClaudeCodeLib } from '../libs/claude-code-lib';
import { CursorAgentLib } from '../libs/cursor-agent-lib';
import { CodexAppServerLib } from '../libs/codex-app-server-lib';
import { CodexCliLib } from '../libs/codex-cli-lib';
import { AgentLibRegistry } from '../services/agent-lib-registry';
import { AgentRunHistoryProvider } from '../services/agent-run-history-provider';
import { AgentSupervisor } from '../services/agent-supervisor';
import { TaskReviewReportBuilder } from '../services/task-review-report-builder';
import { ValidationRunner } from '../services/validation-runner';
import { OutcomeResolver } from '../services/outcome-resolver';
import { TimelineService } from '../services/timeline/timeline-service';
import { EventSource } from '../services/timeline/sources/event-source';
import { ActivitySource } from '../services/timeline/sources/activity-source';
import { TransitionSource } from '../services/timeline/sources/transition-source';
import { AgentRunSource } from '../services/timeline/sources/agent-run-source';
import { PhaseSource } from '../services/timeline/sources/phase-source';
import { ArtifactSource } from '../services/timeline/sources/artifact-source';
import { PromptSource } from '../services/timeline/sources/prompt-source';
import { ContextSource } from '../services/timeline/sources/context-source';
import { SqliteTimelineStore } from '../stores/sqlite-timeline-store';
import { registerCoreGuards } from '../handlers/core-guards';
import { registerAgentHandler, type StreamingCallbacks } from '../handlers/agent-handler';
import { registerNotificationHandler } from '../handlers/notification-handler';
import { registerPromptHandler } from '../handlers/prompt-handler';
import { registerScmHandler } from '../handlers/scm-handler';
import { registerPhaseHandler } from '../handlers/phase-handler';
import { ChatAgentService } from '../services/chat-agent-service';
import { ScheduledAgentService } from '../services/scheduled-agent-service';
import { SchedulerSupervisor } from '../services/scheduler-supervisor';
import { TriageAgentPromptBuilder } from '../services/triage-agent-prompt-builder';
import { DevServerManager, type DevServerManagerCallbacks } from '../services/dev-server-manager';
import type { IDevServerManager } from '../interfaces/dev-server-manager';
import { AgentSubscriptionRegistry } from '../services/agent-subscription-registry';
import { InAppNotificationRouter } from '../services/in-app-notification-router';
import { TelegramBotManager, type TelegramBotManagerCallbacks } from '../services/telegram-bot-manager';
import type { AgentNotificationPayload } from '../../shared/types';

export interface AppServicesConfig {
  createStreamingCallbacks?: (taskId: string) => StreamingCallbacks;
  notificationRouters?: import('../interfaces/notification-router').INotificationRouter[];
  imageStorageDir?: string;
  onInAppNotification?: (type: string, payload: unknown) => void;
  onMainDiverged?: (projectId: string) => void;
  devServerCallbacks?: DevServerManagerCallbacks;
  onAgentSubscriptionFired?: (sessionId: string, payload: AgentNotificationPayload) => void;
  onTaskUpdated?: (taskId: string, task: import('../../shared/types').Task) => void;
  telegramBotManagerCallbacks?: TelegramBotManagerCallbacks;
}

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
  pipelineInspectionService: IPipelineInspectionService;
  taskContextStore: ITaskContextStore;
  featureStore: IFeatureStore;
  agentDefinitionStore: IAgentDefinitionStore;
  kanbanBoardStore: IKanbanBoardStore;
  createWorktreeManager: (path: string) => IWorktreeManager;
  createGitOps: (cwd: string) => import('../interfaces/git-ops').IGitOps;
  createScmPlatform: (path: string) => import('../interfaces/scm-platform').IScmPlatform;
  agentSupervisor: AgentSupervisor;
  timelineService: TimelineService;
  chatMessageStore: IChatMessageStore;
  chatSessionStore: IChatSessionStore;
  chatAgentService: ChatAgentService;
  agentLibRegistry: AgentLibRegistryType;
  settingsStore: ISettingsStore;
  appDebugLog: IAppDebugLog;
  appLogger: AppLogger;
  automatedAgentStore: IAutomatedAgentStore;
  scheduledAgentService: ScheduledAgentService;
  schedulerSupervisor: SchedulerSupervisor;
  inAppNotificationStore: IInAppNotificationStore;
  devServerManager: IDevServerManager;
  subscriptionRegistry: AgentSubscriptionRegistry;
  itemStore: IItemStore;
  telegramBotManager: TelegramBotManager;
}

export function createAppServices(db: Database.Database, config?: AppServicesConfig): AppServices {
  // Phase 1 stores
  const projectStore = new SqliteProjectStore(db);
  const pipelineStore = new SqlitePipelineStore(db);
  const taskStore = new SqliteTaskStore(db, pipelineStore);
  const taskEventLog = new SqliteTaskEventLog(db);
  const activityLog = new SqliteActivityLog(db);
  const agentRunStore = new SqliteAgentRunStore(db);
  const userStore = new SqliteUserStore(db);
  const txRunner = new SqliteTransactionRunner(db);
  const guardContext: import('../../shared/types').IGuardQueryContext = {
    countUnresolvedDependencies: (id: string) => taskStore.countUnresolvedDependenciesSync(id),
    countFailedRuns: (id: string) => agentRunStore.countFailedRunsSync(id),
    countRunningRuns: (id: string) => agentRunStore.countRunningRunsSync(id),
    getUserRole: (username: string) => userStore.getUserRoleSync(username),
  };
  const pipelineEngine = new PipelineEngine(pipelineStore, taskStore, taskEventLog, txRunner, guardContext);
  const appDebugLog = new SqliteAppDebugLog(db);
  const appLogger = initAppLogger(appDebugLog, { verbose: process.env.AM_VERBOSE === '1' });

  // Register built-in guards
  registerCoreGuards(pipelineEngine);

  // Phase 2 stores
  // agentRunStore is created above (needed for guardContext)
  const taskArtifactStore = new SqliteTaskArtifactStore(db);
  const taskPhaseStore = new SqliteTaskPhaseStore(db);
  const pendingPromptStore = new SqlitePendingPromptStore(db);
  const taskContextStore = new SqliteTaskContextStore(db);
  const featureStore = new SqliteFeatureStore(db);
  const agentDefinitionStore = new SqliteAgentDefinitionStore(db);
  const chatMessageStore = new SqliteChatMessageStore(db);
  const chatSessionStore = new SqliteChatSessionStore(db);
  const kanbanBoardStore = new SqliteKanbanBoardStore(db);
  const settingsStore = new SqliteSettingsStore(db);

  // Phase 2 infrastructure — factory functions create project-scoped instances
  const createGitOps = (cwd: string) => new LocalGitOps(cwd);
  const createWorktreeManager = (path: string) => new LocalWorktreeManager(path);
  const createScmPlatform = (path: string) => new GitHubScmPlatform(path);
  const notificationRouter = new MultiChannelNotificationRouter();
  if (config?.notificationRouters) {
    for (const router of config.notificationRouters) {
      notificationRouter.addRouter(router);
    }
  }
  try {
    const resolvedConfig = getResolvedConfig();
    const { botToken, chatId } = validateTelegramConfig(resolvedConfig.telegram?.botToken, resolvedConfig.telegram?.chatId);
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(botToken); // no polling — send-only
    notificationRouter.addRouter(new TelegramNotificationRouter(bot, chatId));
  } catch { /* Telegram not configured */ }

  // Timeline service (created before AgentService because TaskReviewReportBuilder needs it)
  const timelineStore = new SqliteTimelineStore(db);
  const timelineService = new TimelineService([
    new EventSource(timelineStore),
    new ActivitySource(timelineStore),
    new TransitionSource(timelineStore),
    new AgentRunSource(timelineStore),
    new PhaseSource(timelineStore),
    new ArtifactSource(timelineStore),
    new PromptSource(timelineStore),
    new ContextSource(timelineStore),
  ]);

  // Agent lib registry — engines that execute prompts
  const historyProvider = new AgentRunHistoryProvider(agentRunStore);
  const agentLibRegistry = new AgentLibRegistry();
  agentLibRegistry.register(new ClaudeCodeLib());
  agentLibRegistry.register(new CursorAgentLib(historyProvider));
  agentLibRegistry.register(new CodexAppServerLib(historyProvider));
  agentLibRegistry.register(new CodexCliLib(historyProvider));

  // Agent framework — each Agent combines a prompt builder with the lib registry
  const agentFramework = new AgentFrameworkImpl();
  agentFramework.registerAgent(new Agent('planner', new PlannerPromptBuilder(), agentLibRegistry));
  agentFramework.registerAgent(new Agent('designer', new DesignerPromptBuilder(), agentLibRegistry));
  agentFramework.registerAgent(new Agent('implementor', new ImplementorPromptBuilder(), agentLibRegistry));
  agentFramework.registerAgent(new Agent('investigator', new InvestigatorPromptBuilder(), agentLibRegistry));
  agentFramework.registerAgent(new Agent('reviewer', new ReviewerPromptBuilder(), agentLibRegistry));
  agentFramework.registerAgent(new Agent('task-workflow-reviewer', new TaskWorkflowReviewerPromptBuilder(), agentLibRegistry));

  // Report builder for workflow reviewer agent
  const taskReviewReportBuilder = new TaskReviewReportBuilder(
    agentRunStore, taskEventLog, taskContextStore,
    taskArtifactStore, taskStore, timelineService,
  );

  // Validation runner + outcome resolver for agent post-processing
  const validationRunner = new ValidationRunner(agentRunStore, taskEventLog);
  const outcomeResolver = new OutcomeResolver(
    createGitOps, pipelineEngine, taskStore,
    taskPhaseStore, taskArtifactStore, taskEventLog,
  );

  // Automated agent stores and services (created before AgentService so it can be passed in for stop delegation)
  const automatedAgentStore = new SqliteAutomatedAgentStore(db);
  const inAppNotificationStore = new SqliteInAppNotificationStore(db);
  notificationRouter.addRouter(new InAppNotificationRouter(
    inAppNotificationStore,
    (type, payload) => config?.onInAppNotification?.(type, payload),
  ));
  const itemStore = new SqliteItemStore(db);
  const triageBuilder = new TriageAgentPromptBuilder(taskStore, taskContextStore);
  const promptBuilders = new Map([[triageBuilder.templateId, triageBuilder]]);
  const scheduledAgentService = new ScheduledAgentService(
    automatedAgentStore, agentRunStore, projectStore, taskStore,
    agentLibRegistry, notificationRouter, promptBuilders,
  );
  const schedulerSupervisor = new SchedulerSupervisor(automatedAgentStore, scheduledAgentService);

  // Dev server manager
  const devServerManager = new DevServerManager(config?.devServerCallbacks);

  // Agent subscription registry (in-memory, single-fire + TTL)
  const subscriptionRegistry = new AgentSubscriptionRegistry();

  // Agent service
  const agentService = new AgentService(
    agentFramework, agentRunStore, createWorktreeManager,
    taskStore, projectStore,
    taskEventLog, taskPhaseStore, pendingPromptStore,
    createGitOps, taskContextStore, agentDefinitionStore,
    taskReviewReportBuilder, notificationRouter,
    validationRunner, outcomeResolver,
    scheduledAgentService, agentLibRegistry, devServerManager,
    subscriptionRegistry, config?.onAgentSubscriptionFired,
    config?.onTaskUpdated,
  );

  // Workflow service
  const workflowService = new WorkflowService(
    taskStore, projectStore, pipelineEngine, pipelineStore,
    taskEventLog, activityLog, agentRunStore, pendingPromptStore,
    taskArtifactStore, agentService, createScmPlatform, createWorktreeManager,
    createGitOps, taskContextStore, devServerManager,
  );

  // Pipeline inspection service (diagnostics, hook retry, phase advance)
  const pipelineInspectionService = new PipelineInspectionService(
    taskStore, pipelineEngine, pipelineStore,
    taskEventLog, activityLog, agentRunStore,
  );

  // Supervisor for detecting timed-out agent runs + stall recovery
  const agentSupervisor = new AgentSupervisor(
    agentRunStore, agentService, taskEventLog,
    undefined, undefined, // use default pollIntervalMs and defaultTimeoutMs
    taskStore, pipelineStore, workflowService,
  );

  // Chat agent service (unified: handles both project and task scopes)
  const getDefaultAgentLib = () => {
    try {
      return settingsStore.get('chat_default_agent_lib', 'claude-code');
    } catch (err) {
      getAppLogger().logError('setup', 'Failed to read chat_default_agent_lib setting', err);
      return 'claude-code';
    }
  };
  const getDefaultModel = (): string | null => {
    try {
      return settingsStore.get('chat_default_model', '') || null;
    } catch (err) {
      getAppLogger().logError('setup', 'Failed to read chat_default_model setting', err);
      return null;
    }
  };
  const getDefaultPermissionMode = (): import('../../shared/types').PermissionMode | null => {
    try {
      const value = settingsStore.get('chat_default_permission_mode', '');
      return (value as import('../../shared/types').PermissionMode) || null;
    } catch (err) {
      getAppLogger().logError('setup', 'Failed to read chat_default_permission_mode setting', err);
      return null;
    }
  };
  const chatAgentService = new ChatAgentService(chatMessageStore, chatSessionStore, projectStore, taskStore, pipelineStore, agentLibRegistry, agentRunStore, getDefaultAgentLib, getDefaultModel, getDefaultPermissionMode, config?.imageStorageDir, subscriptionRegistry);

  // Wire cross-service injected message handler (avoids circular deps)
  agentService.setInjectedMessageHandler(
    (sessionId, content, metadata) =>
      chatAgentService.enqueueInjectedMessage(sessionId, content, metadata),
  );

  // Telegram bot manager — handles bot lifecycle and notification router registration
  const telegramBotManager = new TelegramBotManager(
    {
      projectStore, taskStore, pipelineStore, pipelineEngine,
      workflowService, chatSessionStore, chatAgentService,
      agentRunStore, settingsStore, notificationRouter,
    },
    config?.telegramBotManagerCallbacks,
  );

  // Register hooks (must be after workflowService is created)
  registerAgentHandler(pipelineEngine, { workflowService, taskEventLog, agentRunStore, createStreamingCallbacks: config?.createStreamingCallbacks });
  registerNotificationHandler(pipelineEngine, { notificationRouter, taskStore });
  registerPromptHandler(pipelineEngine, { pendingPromptStore, taskEventLog });
  registerScmHandler(pipelineEngine, {
    projectStore, taskStore, taskArtifactStore, taskEventLog, taskContextStore,
    createWorktreeManager, createGitOps, createScmPlatform,
    onMainDiverged: config?.onMainDiverged,
  });
  registerPhaseHandler(pipelineEngine, {
    taskStore, taskArtifactStore, taskEventLog, pipelineEngine,
    projectStore, createScmPlatform,
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
    pipelineInspectionService,
    taskContextStore,
    featureStore,
    agentDefinitionStore,
    kanbanBoardStore,
    createWorktreeManager,
    createGitOps,
    createScmPlatform,
    agentSupervisor,
    timelineService,
    chatMessageStore,
    chatSessionStore,
    chatAgentService,
    agentLibRegistry,
    settingsStore,
    appDebugLog,
    appLogger,
    automatedAgentStore,
    scheduledAgentService,
    schedulerSupervisor,
    inAppNotificationStore,
    devServerManager,
    subscriptionRegistry,
    itemStore,
    telegramBotManager,
  };
}
