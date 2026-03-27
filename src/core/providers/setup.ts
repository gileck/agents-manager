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
import type { ITaskDocStore } from '../interfaces/task-doc-store';
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
import { SqliteTaskDocStore } from '../stores/sqlite-task-doc-store';
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
import { AGENT_BUILDERS } from '../agents/agent-builders';
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
  taskDocStore: ITaskDocStore;
  telegramBotManager: TelegramBotManager;
}

// ---------------------------------------------------------------------------
// Domain installer functions (private — not exported)
// ---------------------------------------------------------------------------

/**
 * createStores — All SQLite store and infrastructure instantiations.
 * Depends on: db
 * Produces: all stores (including userStore and txRunner used only internally)
 */
function createStores(db: Database.Database) {
  // Phase 1 stores
  const projectStore = new SqliteProjectStore(db);
  const pipelineStore = new SqlitePipelineStore(db);
  const taskStore = new SqliteTaskStore(db, pipelineStore); // depends on pipelineStore
  const taskEventLog = new SqliteTaskEventLog(db);
  const activityLog = new SqliteActivityLog(db);
  const agentRunStore = new SqliteAgentRunStore(db);
  const userStore = new SqliteUserStore(db);     // used only for guardContext in createPipelineModule
  const txRunner = new SqliteTransactionRunner(db); // used only by PipelineEngine
  const appDebugLog = new SqliteAppDebugLog(db);
  // Phase 2 stores
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
  const automatedAgentStore = new SqliteAutomatedAgentStore(db);
  const inAppNotificationStore = new SqliteInAppNotificationStore(db);
  const itemStore = new SqliteItemStore(db);
  const taskDocStore = new SqliteTaskDocStore(db);
  return {
    projectStore, pipelineStore, taskStore, taskEventLog, activityLog,
    agentRunStore, userStore, txRunner, appDebugLog,
    taskArtifactStore, taskPhaseStore, pendingPromptStore, taskContextStore,
    featureStore, agentDefinitionStore, chatMessageStore, chatSessionStore,
    kanbanBoardStore, settingsStore, automatedAgentStore, inAppNotificationStore, itemStore,
    taskDocStore,
  };
}

/**
 * createPipelineModule — PipelineEngine + core guard registration.
 * Depends on: stores (pipelineStore, taskStore, taskEventLog, txRunner, agentRunStore, userStore)
 * Produces: pipelineEngine
 */
function createPipelineModule(stores: ReturnType<typeof createStores>) {
  const guardContext: import('../../shared/types').IGuardQueryContext = {
    countUnresolvedDependencies: (id: string) => stores.taskStore.countUnresolvedDependenciesSync(id),
    countFailedRuns: (id: string, agentType?: string) => stores.agentRunStore.countFailedRunsSync(id, agentType),
    countRunningRuns: (id: string) => stores.agentRunStore.countRunningRunsSync(id),
    getUserRole: (username: string) => stores.userStore.getUserRoleSync(username),
  };
  const pipelineEngine = new PipelineEngine(
    stores.pipelineStore, stores.taskStore, stores.taskEventLog, stores.txRunner, guardContext,
  );
  registerCoreGuards(pipelineEngine);
  return { pipelineEngine };
}

/**
 * createNotificationModule — MultiChannelNotificationRouter wired with external, Telegram, and in-app routers.
 * Depends on: stores.inAppNotificationStore, config.notificationRouters, config.onInAppNotification
 * Produces: notificationRouter
 */
function createNotificationModule(
  stores: ReturnType<typeof createStores>,
  config?: AppServicesConfig,
) {
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
  notificationRouter.addRouter(new InAppNotificationRouter(
    stores.inAppNotificationStore,
    (type, payload) => config?.onInAppNotification?.(type, payload),
  ));
  return { notificationRouter };
}

/**
 * createTimelineModule — SqliteTimelineStore + TimelineService with all 8 event sources.
 * Depends on: db
 * Produces: timelineService
 */
function createTimelineModule(db: Database.Database) {
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
  return { timelineService };
}

/**
 * createAgentModule — Agent lib registry, framework, report builder, validation, outcome,
 *   scheduled agent service (created before AgentService as it is a hard dependency),
 *   dev server, subscription registry, and AgentService.
 * Depends on: stores, pipelineEngine, timelineService, notificationRouter,
 *   createGitOps, createWorktreeManager, config
 * Produces: agentService, agentFramework, agentLibRegistry, devServerManager,
 *   subscriptionRegistry, scheduledAgentService
 */
function createAgentModule(
  stores: ReturnType<typeof createStores>,
  pipelineEngine: IPipelineEngine,
  timelineService: TimelineService,
  notificationRouter: MultiChannelNotificationRouter,
  createGitOps: (cwd: string) => import('../interfaces/git-ops').IGitOps,
  createWorktreeManager: (path: string) => IWorktreeManager,
  config?: AppServicesConfig,
) {
  // Agent lib registry — engines that execute prompts
  const historyProvider = new AgentRunHistoryProvider(stores.agentRunStore);
  const agentLibRegistry = new AgentLibRegistry();
  agentLibRegistry.register(new ClaudeCodeLib());
  agentLibRegistry.register(new CursorAgentLib(historyProvider));
  agentLibRegistry.register(new CodexAppServerLib(historyProvider));
  agentLibRegistry.register(new CodexCliLib(historyProvider));

  // Agent framework — each Agent combines a prompt builder with the lib registry
  const agentFramework = new AgentFrameworkImpl();
  for (const [type, BuilderClass] of Object.entries(AGENT_BUILDERS)) {
    agentFramework.registerAgent(new Agent(type, new BuilderClass(), agentLibRegistry));
  }

  // Report builder for workflow reviewer agent
  const taskReviewReportBuilder = new TaskReviewReportBuilder(
    stores.agentRunStore, stores.taskEventLog, stores.taskContextStore,
    stores.taskArtifactStore, stores.taskStore, timelineService,
    stores.taskDocStore,
  );

  // Validation runner + outcome resolver for agent post-processing
  const validationRunner = new ValidationRunner(stores.agentRunStore, stores.taskEventLog);
  const outcomeResolver = new OutcomeResolver(
    createGitOps, pipelineEngine, stores.taskStore,
    stores.taskPhaseStore, stores.taskArtifactStore, stores.taskEventLog,
    stores.agentRunStore,
  );

  // Scheduled agent service (created before AgentService — it is passed in as a dependency)
  const scheduledAgentService = new ScheduledAgentService(
    stores.automatedAgentStore, stores.agentRunStore, stores.projectStore, stores.taskStore,
    agentLibRegistry, notificationRouter, new Map(),
  );

  // Dev server manager and in-memory subscription registry
  const devServerManager = new DevServerManager(config?.devServerCallbacks);
  const subscriptionRegistry = new AgentSubscriptionRegistry();

  // Agent service
  const agentService = new AgentService(
    agentFramework, stores.agentRunStore, createWorktreeManager,
    stores.taskStore, stores.projectStore,
    stores.taskEventLog, stores.taskPhaseStore, stores.pendingPromptStore,
    createGitOps, stores.taskContextStore, stores.agentDefinitionStore,
    taskReviewReportBuilder, notificationRouter,
    validationRunner, outcomeResolver,
    scheduledAgentService, agentLibRegistry, devServerManager,
    subscriptionRegistry, config?.onAgentSubscriptionFired,
    config?.onTaskUpdated,
    stores.taskDocStore,
  );

  return { agentService, agentFramework, agentLibRegistry, devServerManager, subscriptionRegistry, scheduledAgentService };
}

/**
 * createChatModule — ChatAgentService with settings-driven default lib resolution.
 * Depends on: stores (chatMessageStore, chatSessionStore, projectStore, taskStore, pipelineStore,
 *   agentRunStore, settingsStore), agentLibRegistry, subscriptionRegistry, config.imageStorageDir
 * Produces: chatAgentService
 */
function createChatModule(
  stores: ReturnType<typeof createStores>,
  agentLibRegistry: AgentLibRegistryType,
  subscriptionRegistry: AgentSubscriptionRegistry,
  config?: AppServicesConfig,
) {
  const getDefaultAgentLib = () => {
    try {
      return stores.settingsStore.get('chat_default_agent_lib', 'claude-code');
    } catch (err) {
      getAppLogger().logError('setup', 'Failed to read chat_default_agent_lib setting', err);
      return 'claude-code';
    }
  };
  const getDefaultModel = (): string | null => {
    try {
      return stores.settingsStore.get('chat_default_model', '') || null;
    } catch (err) {
      getAppLogger().logError('setup', 'Failed to read chat_default_model setting', err);
      return null;
    }
  };
  const getDefaultPermissionMode = (): import('../../shared/types').PermissionMode | null => {
    try {
      const value = stores.settingsStore.get('chat_default_permission_mode', '');
      return (value as import('../../shared/types').PermissionMode) || null;
    } catch (err) {
      getAppLogger().logError('setup', 'Failed to read chat_default_permission_mode setting', err);
      return null;
    }
  };
  const chatAgentService = new ChatAgentService(
    stores.chatMessageStore, stores.chatSessionStore, stores.projectStore, stores.taskStore,
    stores.pipelineStore, agentLibRegistry, stores.agentRunStore, getDefaultAgentLib,
    getDefaultModel, getDefaultPermissionMode, config?.imageStorageDir, subscriptionRegistry,
    stores.taskContextStore, stores.taskDocStore,
  );
  return { chatAgentService };
}

/**
 * createAutomationModule — SchedulerSupervisor that supervises the scheduled agent service.
 * Depends on: stores.automatedAgentStore, scheduledAgentService
 * Produces: schedulerSupervisor
 */
function createAutomationModule(
  stores: ReturnType<typeof createStores>,
  scheduledAgentService: ScheduledAgentService,
) {
  const schedulerSupervisor = new SchedulerSupervisor(stores.automatedAgentStore, scheduledAgentService);
  return { schedulerSupervisor };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createAppServices(db: Database.Database, config?: AppServicesConfig): AppServices {
  // 1. All SQLite stores
  const stores = createStores(db);
  const appLogger = initAppLogger(stores.appDebugLog, { verbose: process.env.AM_VERBOSE === '1' });

  // 2. Pipeline engine (builds guardContext internally from stores)
  const { pipelineEngine } = createPipelineModule(stores);

  // 3. Factory lambdas — project-scoped instances, used by multiple modules and hook registrations
  const createGitOps = (cwd: string) => new LocalGitOps(cwd);
  const createWorktreeManager = (path: string) => new LocalWorktreeManager(path);
  const createScmPlatform = (path: string) => new GitHubScmPlatform(path);

  // 4. Notification routing
  const { notificationRouter } = createNotificationModule(stores, config);

  // 5. Timeline service (created before AgentService because TaskReviewReportBuilder needs it)
  const { timelineService } = createTimelineModule(db);

  // 6. Agent module (lib registry, framework, automation services, and agent service)
  const {
    agentService, agentFramework, agentLibRegistry,
    devServerManager, subscriptionRegistry, scheduledAgentService,
  } = createAgentModule(stores, pipelineEngine, timelineService, notificationRouter, createGitOps, createWorktreeManager, config);

  // 7. Cross-cutting orchestration services (consume multiple domains — stay inline)
  const workflowService = new WorkflowService(
    stores.taskStore, stores.projectStore, pipelineEngine, stores.pipelineStore,
    stores.taskEventLog, stores.activityLog, stores.agentRunStore, stores.pendingPromptStore,
    stores.taskArtifactStore, agentService, createScmPlatform, createWorktreeManager,
    createGitOps, stores.taskContextStore, devServerManager,
  );
  const pipelineInspectionService = new PipelineInspectionService(
    stores.taskStore, pipelineEngine, stores.pipelineStore,
    stores.taskEventLog, stores.activityLog, stores.agentRunStore,
  );
  const agentSupervisor = new AgentSupervisor(
    stores.agentRunStore, agentService, stores.taskEventLog,
    undefined, undefined, // use default pollIntervalMs and defaultTimeoutMs
    stores.taskStore, stores.pipelineStore, workflowService,
  );

  // 8. Chat module
  const { chatAgentService } = createChatModule(stores, agentLibRegistry, subscriptionRegistry, config);

  // 9. Automation module (scheduler supervisor — scheduled agent service lives in agent module)
  const { schedulerSupervisor } = createAutomationModule(stores, scheduledAgentService);

  // 10. Wire cross-service injected message handler (avoids circular deps)
  agentService.setInjectedMessageHandler(
    (sessionId, content, metadata) =>
      chatAgentService.enqueueInjectedMessage(sessionId, content, metadata),
  );

  // 11. Telegram bot manager — handles bot lifecycle and notification router registration
  const telegramBotManager = new TelegramBotManager(
    {
      projectStore: stores.projectStore, taskStore: stores.taskStore, pipelineStore: stores.pipelineStore,
      pipelineEngine, workflowService, chatSessionStore: stores.chatSessionStore, chatAgentService,
      agentRunStore: stores.agentRunStore, settingsStore: stores.settingsStore, notificationRouter,
      createNotificationRouter: (bot, chatId) => new TelegramNotificationRouter(bot, chatId),
    },
    config?.telegramBotManagerCallbacks,
  );

  // 12. Register pipeline hooks (must be after workflowService is created)
  registerAgentHandler(pipelineEngine, { workflowService, taskEventLog: stores.taskEventLog, agentRunStore: stores.agentRunStore, createStreamingCallbacks: config?.createStreamingCallbacks });
  registerNotificationHandler(pipelineEngine, { notificationRouter, taskStore: stores.taskStore });
  registerPromptHandler(pipelineEngine, { pendingPromptStore: stores.pendingPromptStore, taskEventLog: stores.taskEventLog });
  registerScmHandler(pipelineEngine, {
    projectStore: stores.projectStore, taskStore: stores.taskStore, taskArtifactStore: stores.taskArtifactStore,
    taskEventLog: stores.taskEventLog, taskContextStore: stores.taskContextStore,
    createWorktreeManager, createGitOps, createScmPlatform,
    onMainDiverged: config?.onMainDiverged,
  });
  registerPhaseHandler(pipelineEngine, {
    taskStore: stores.taskStore, taskArtifactStore: stores.taskArtifactStore, taskEventLog: stores.taskEventLog,
    pipelineEngine, projectStore: stores.projectStore, createScmPlatform,
  });

  return {
    db,
    projectStore: stores.projectStore,
    pipelineStore: stores.pipelineStore,
    taskStore: stores.taskStore,
    taskEventLog: stores.taskEventLog,
    activityLog: stores.activityLog,
    pipelineEngine,
    agentRunStore: stores.agentRunStore,
    taskArtifactStore: stores.taskArtifactStore,
    taskPhaseStore: stores.taskPhaseStore,
    pendingPromptStore: stores.pendingPromptStore,
    agentFramework,
    notificationRouter,
    agentService,
    workflowService,
    pipelineInspectionService,
    taskContextStore: stores.taskContextStore,
    featureStore: stores.featureStore,
    agentDefinitionStore: stores.agentDefinitionStore,
    kanbanBoardStore: stores.kanbanBoardStore,
    createWorktreeManager,
    createGitOps,
    createScmPlatform,
    agentSupervisor,
    timelineService,
    chatMessageStore: stores.chatMessageStore,
    chatSessionStore: stores.chatSessionStore,
    chatAgentService,
    agentLibRegistry,
    settingsStore: stores.settingsStore,
    appDebugLog: stores.appDebugLog,
    appLogger,
    automatedAgentStore: stores.automatedAgentStore,
    scheduledAgentService,
    schedulerSupervisor,
    inAppNotificationStore: stores.inAppNotificationStore,
    devServerManager,
    subscriptionRegistry,
    itemStore: stores.itemStore,
    taskDocStore: stores.taskDocStore,
    telegramBotManager,
  };
}
