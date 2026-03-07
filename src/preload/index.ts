import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  Item, ItemCreateInput, ItemUpdateInput, AppSettings,
  Project, ProjectCreateInput, ProjectUpdateInput,
  Task, TaskCreateInput, TaskUpdateInput, TaskFilter,
  Feature, FeatureCreateInput, FeatureUpdateInput, FeatureFilter,
  Pipeline, Transition,
  AgentRun, AgentMode, AgentRunStatus,
  AgentDefinition, AgentDefinitionCreateInput, AgentDefinitionUpdateInput,
  TaskEvent, TaskEventFilter,
  ActivityEntry, ActivityFilter,
  PendingPrompt,
  TaskArtifact,
  TaskContextEntry,
  TransitionResult,
  DashboardStats,
  DebugTimelineEntry,
  GitLogEntry,
  GitCommitDetail,
  Worktree,
  ChatMessage,
  ChatImage,
  AgentChatMessage,
  ChatSession,
  TaskChatSessionWithTitle,
  RunningAgent,
  TelegramBotLogEntry,
  AllTransitionsResult,
  GuardCheckResult,
  HookRetryResult,
  PipelineDiagnostics,
  TransitionTrigger,
  KanbanBoardConfig,
  KanbanBoardCreateInput,
  KanbanBoardUpdateInput,
  AppDebugLogEntry,
  AppDebugLogFilter,
  PRChecksResult,
  AutomatedAgent,
  AutomatedAgentCreateInput,
  AutomatedAgentUpdateInput,
  AutomatedAgentTemplate,
} from '../shared/types';

// Channel constants must be inlined here — Electron's sandboxed preload
// cannot require() sibling modules. Keep in sync with src/shared/ipc-channels.ts.
const IPC_CHANNELS = {
  ITEM_LIST: 'item:list',
  ITEM_GET: 'item:get',
  ITEM_CREATE: 'item:create',
  ITEM_UPDATE: 'item:update',
  ITEM_DELETE: 'item:delete',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  APP_GET_VERSION: 'app:get-version',
  NAVIGATE: 'navigate',
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
  TASK_LIST: 'task:list',
  TASK_GET: 'task:get',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  TASK_RESET: 'task:reset',
  TASK_TRANSITION: 'task:transition',
  TASK_TRANSITIONS: 'task:transitions',
  TASK_DEPENDENCIES: 'task:dependencies',
  TASK_DEPENDENTS: 'task:dependents',
  TASK_ADD_DEPENDENCY: 'task:add-dependency',
  TASK_REMOVE_DEPENDENCY: 'task:remove-dependency',
  TASK_ALL_TRANSITIONS: 'task:all-transitions',
  TASK_FORCE_TRANSITION: 'task:force-transition',
  TASK_GUARD_CHECK: 'task:guard-check',
  TASK_HOOK_RETRY: 'task:hook-retry',
  TASK_PIPELINE_DIAGNOSTICS: 'task:pipeline-diagnostics',
  TASK_ADVANCE_PHASE: 'task:advance-phase',
  PIPELINE_LIST: 'pipeline:list',
  PIPELINE_GET: 'pipeline:get',
  AGENT_START: 'agent:start',
  AGENT_STOP: 'agent:stop',
  AGENT_RUNS: 'agent:runs',
  AGENT_GET: 'agent:get',
  AGENT_OUTPUT: 'agent:output',
  AGENT_ACTIVE_TASK_IDS: 'agent:active-task-ids',
  AGENT_ACTIVE_RUNS: 'agent:active-runs',
  AGENT_ALL_RUNS: 'agent:all-runs',
  AGENT_INTERRUPTED_RUNS: 'agent:interrupted-runs',
  AGENT_MESSAGE: 'agent:message',
  AGENT_STATUS: 'agent:status',
  AGENT_SEND_MESSAGE: 'agent:send-message',
  EVENT_LIST: 'event:list',
  ACTIVITY_LIST: 'activity:list',
  PROMPT_LIST: 'prompt:list',
  PROMPT_RESPOND: 'prompt:respond',
  ARTIFACT_LIST: 'artifact:list',
  TASK_CONTEXT_ENTRIES: 'task:context-entries',
  TASK_ADD_CONTEXT_ENTRY: 'task:add-context-entry',
  TASK_ADD_FEEDBACK: 'task:add-feedback',
  TASK_DEBUG_TIMELINE: 'task:debug-timeline',
  TASK_WORKTREE: 'task:worktree',
  FEATURE_LIST: 'feature:list',
  FEATURE_GET: 'feature:get',
  FEATURE_CREATE: 'feature:create',
  FEATURE_UPDATE: 'feature:update',
  FEATURE_DELETE: 'feature:delete',
  AGENT_DEF_LIST: 'agent-def:list',
  AGENT_DEF_GET: 'agent-def:get',
  AGENT_DEF_CREATE: 'agent-def:create',
  AGENT_DEF_UPDATE: 'agent-def:update',
  AGENT_DEF_DELETE: 'agent-def:delete',
  GIT_DIFF: 'git:diff',
  GIT_STAT: 'git:stat',
  GIT_WORKING_DIFF: 'git:working-diff',
  GIT_STATUS: 'git:status',
  GIT_RESET_FILE: 'git:reset-file',
  GIT_CLEAN: 'git:clean',
  GIT_PULL: 'git:pull',
  GIT_LOG: 'git:log',
  GIT_SHOW: 'git:show',
  GIT_PR_CHECKS: 'git:pr-checks',
  GIT_SYNC_MAIN: 'git:sync-main',
  MAIN_DIVERGED: 'git:main-diverged',
  TASK_WORKFLOW_REVIEW: 'task:workflow-review',
  DASHBOARD_STATS: 'dashboard:stats',
  TELEGRAM_TEST: 'telegram:test',
  TELEGRAM_BOT_START: 'telegram:bot-start',
  TELEGRAM_BOT_STOP: 'telegram:bot-stop',
  TELEGRAM_BOT_STATUS: 'telegram:bot-status',
  TELEGRAM_BOT_LOG: 'telegram:bot-log',
  TELEGRAM_BOT_SESSION: 'telegram:bot-session',
  TELEGRAM_BOT_STATUS_CHANGED: 'telegram:bot-status-changed',
  OPEN_IN_CHROME: 'shell:open-in-chrome',
  OPEN_IN_ITERM: 'shell:open-in-iterm',
  OPEN_IN_VSCODE: 'shell:open-in-vscode',
  OPEN_FILE_IN_VSCODE: 'shell:open-file-in-vscode',
  CHAT_SEND: 'chat:send',
  CHAT_STOP: 'chat:stop',
  CHAT_MESSAGES: 'chat:messages',
  CHAT_CLEAR: 'chat:clear',
  CHAT_SUMMARIZE: 'chat:summarize',
  CHAT_OUTPUT: 'chat:output',
  CHAT_MESSAGE: 'chat:message',
  TASK_CHAT_OUTPUT: 'task-chat:output',
  TASK_CHAT_MESSAGE: 'task-chat:message',
  CHAT_COSTS: 'chat:costs',
  CHAT_SESSION_CREATE: 'chat:session:create',
  CHAT_SESSION_LIST: 'chat:session:list',
  CHAT_SESSION_LIST_TASK_SESSIONS: 'chat:session:list-task-sessions',
  CHAT_SESSION_UPDATE: 'chat:session:update',
  CHAT_SESSION_DELETE: 'chat:session:delete',
  CHAT_AGENT_SESSION: 'chat:agent-session',
  CHAT_AGENTS_LIST: 'chat:agents:list',
  CHAT_SESSION_RENAMED: 'chat:session:renamed',
  AGENT_LIB_LIST: 'agent-lib:list',
  GIT_PROJECT_LOG: 'git:project-log',
  GIT_BRANCH: 'git:branch',
  GIT_COMMIT_DETAIL: 'git:commit-detail',
  KANBAN_BOARD_GET: 'kanban-board:get',
  KANBAN_BOARD_GET_BY_PROJECT: 'kanban-board:get-by-project',
  KANBAN_BOARD_LIST: 'kanban-board:list',
  KANBAN_BOARD_CREATE: 'kanban-board:create',
  KANBAN_BOARD_UPDATE: 'kanban-board:update',
  KANBAN_BOARD_DELETE: 'kanban-board:delete',
  AGENT_LIB_LIST_MODELS: 'agent-lib:list-models',
  DEBUG_LOG_LIST: 'debug-log:list',
  DEBUG_LOG_CLEAR: 'debug-log:clear',
  AUTOMATED_AGENT_LIST: 'automated-agent:list',
  AUTOMATED_AGENT_GET: 'automated-agent:get',
  AUTOMATED_AGENT_CREATE: 'automated-agent:create',
  AUTOMATED_AGENT_UPDATE: 'automated-agent:update',
  AUTOMATED_AGENT_DELETE: 'automated-agent:delete',
  AUTOMATED_AGENT_TRIGGER: 'automated-agent:trigger',
  AUTOMATED_AGENT_RUNS: 'automated-agent:runs',
  AUTOMATED_AGENT_TEMPLATES: 'automated-agent:templates',
} as const;

// Define the API that will be exposed to the renderer
const api = {
  // Item operations (template)
  items: {
    list: (): Promise<Item[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_LIST),
    get: (id: string): Promise<Item | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET, id),
    create: (input: ItemCreateInput): Promise<Item> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_CREATE, input),
    update: (id: string, input: ItemUpdateInput): Promise<Item | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_UPDATE, id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_DELETE, id),
  },

  // Settings operations
  settings: {
    get: (): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    update: (updates: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, updates),
  },

  // App operations
  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  },

  // Project operations
  projects: {
    list: (): Promise<Project[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LIST),
    get: (id: string): Promise<Project | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT_GET, id),
    create: (input: ProjectCreateInput): Promise<Project> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT_CREATE, input),
    update: (id: string, input: ProjectUpdateInput): Promise<Project | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT_UPDATE, id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT_DELETE, id),
  },

  // Task operations
  tasks: {
    list: (filter?: TaskFilter): Promise<Task[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST, filter),
    get: (id: string): Promise<Task | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_GET, id),
    create: (input: TaskCreateInput): Promise<Task> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, input),
    update: (id: string, input: TaskUpdateInput): Promise<Task | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_UPDATE, id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_DELETE, id),
    reset: (id: string, pipelineId?: string): Promise<Task | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_RESET, id, pipelineId),
    transition: (taskId: string, toStatus: string, actor?: string): Promise<TransitionResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_TRANSITION, taskId, toStatus, actor),
    transitions: (taskId: string): Promise<Transition[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_TRANSITIONS, taskId),
    dependencies: (taskId: string): Promise<Task[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_DEPENDENCIES, taskId),
    dependents: (taskId: string): Promise<Task[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_DEPENDENTS, taskId),
    addDependency: (taskId: string, dependsOnTaskId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_ADD_DEPENDENCY, taskId, dependsOnTaskId),
    removeDependency: (taskId: string, dependsOnTaskId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_REMOVE_DEPENDENCY, taskId, dependsOnTaskId),
    allTransitions: (taskId: string): Promise<AllTransitionsResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_ALL_TRANSITIONS, taskId),
    forceTransition: (taskId: string, toStatus: string, actor?: string): Promise<TransitionResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_FORCE_TRANSITION, taskId, toStatus, actor),
    guardCheck: (taskId: string, toStatus: string, trigger: TransitionTrigger): Promise<GuardCheckResult | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_GUARD_CHECK, taskId, toStatus, trigger),
    hookRetry: (taskId: string, hookName: string, transitionFrom?: string, transitionTo?: string): Promise<HookRetryResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_HOOK_RETRY, taskId, hookName, transitionFrom, transitionTo),
    pipelineDiagnostics: (taskId: string): Promise<PipelineDiagnostics | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_PIPELINE_DIAGNOSTICS, taskId),
    advancePhase: (taskId: string): Promise<TransitionResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_ADVANCE_PHASE, taskId),
    contextEntries: (taskId: string): Promise<TaskContextEntry[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_CONTEXT_ENTRIES, taskId),
    addContextEntry: (taskId: string, input: { source: string; entryType: string; summary: string; data?: Record<string, unknown> }): Promise<TaskContextEntry> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_ADD_CONTEXT_ENTRY, taskId, input),
    addFeedback: (taskId: string, input: { entryType: string; content: string; source?: string; agentRunId?: string }): Promise<TaskContextEntry> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_ADD_FEEDBACK, taskId, input),
    debugTimeline: (taskId: string): Promise<DebugTimelineEntry[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_DEBUG_TIMELINE, taskId),
    worktree: (taskId: string): Promise<Worktree | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKTREE, taskId),
    workflowReview: (taskId: string): Promise<AgentRun> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_WORKFLOW_REVIEW, taskId),
  },

  // Feature operations
  features: {
    list: (filter?: FeatureFilter): Promise<Feature[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.FEATURE_LIST, filter),
    get: (id: string): Promise<Feature | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.FEATURE_GET, id),
    create: (input: FeatureCreateInput): Promise<Feature> =>
      ipcRenderer.invoke(IPC_CHANNELS.FEATURE_CREATE, input),
    update: (id: string, input: FeatureUpdateInput): Promise<Feature | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.FEATURE_UPDATE, id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.FEATURE_DELETE, id),
  },

  // Kanban Board operations
  kanbanBoards: {
    get: (id: string): Promise<KanbanBoardConfig | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.KANBAN_BOARD_GET, id),
    getByProject: (projectId: string): Promise<KanbanBoardConfig | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.KANBAN_BOARD_GET_BY_PROJECT, projectId),
    list: (projectId: string): Promise<KanbanBoardConfig[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.KANBAN_BOARD_LIST, projectId),
    create: (input: KanbanBoardCreateInput): Promise<KanbanBoardConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.KANBAN_BOARD_CREATE, input),
    update: (id: string, input: KanbanBoardUpdateInput): Promise<KanbanBoardConfig | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.KANBAN_BOARD_UPDATE, id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.KANBAN_BOARD_DELETE, id),
  },

  // Agent definition operations
  agentDefinitions: {
    list: (): Promise<AgentDefinition[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_DEF_LIST),
    get: (id: string): Promise<AgentDefinition | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_DEF_GET, id),
    create: (input: AgentDefinitionCreateInput): Promise<AgentDefinition> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_DEF_CREATE, input),
    update: (id: string, input: AgentDefinitionUpdateInput): Promise<AgentDefinition | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_DEF_UPDATE, id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_DEF_DELETE, id),
  },

  // Agent lib operations
  agentLibs: {
    list: (): Promise<{ name: string; available: boolean }[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_LIB_LIST),
    listModels: (): Promise<Record<string, { models: { value: string; label: string }[]; defaultModel: string }>> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_LIB_LIST_MODELS),
  },

  // Pipeline operations
  pipelines: {
    list: (): Promise<Pipeline[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.PIPELINE_LIST),
    get: (id: string): Promise<Pipeline | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.PIPELINE_GET, id),
  },

  // Agent operations
  agents: {
    start: (taskId: string, mode: AgentMode, agentType: string): Promise<AgentRun> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_START, taskId, mode, agentType),
    stop: (runId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_STOP, runId),
    runs: (taskId: string): Promise<AgentRun[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_RUNS, taskId),
    get: (runId: string): Promise<AgentRun | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET, runId),
    activeTaskIds: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_ACTIVE_TASK_IDS),
    activeRuns: (): Promise<AgentRun[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_ACTIVE_RUNS),
    allRuns: (): Promise<AgentRun[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_ALL_RUNS),
    sendMessage: (taskId: string, message: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_SEND_MESSAGE, taskId, message),
  },

  // Event operations
  events: {
    list: (filter?: TaskEventFilter): Promise<TaskEvent[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.EVENT_LIST, filter),
  },

  // Activity operations
  activity: {
    list: (filter?: ActivityFilter): Promise<ActivityEntry[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.ACTIVITY_LIST, filter),
  },

  // Prompt operations
  prompts: {
    list: (taskId: string): Promise<PendingPrompt[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROMPT_LIST, taskId),
    respond: (promptId: string, response: Record<string, unknown>): Promise<PendingPrompt | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROMPT_RESPOND, promptId, response),
  },

  // Artifact operations
  artifacts: {
    list: (taskId: string): Promise<TaskArtifact[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.ARTIFACT_LIST, taskId),
  },

  // Git operations
  git: {
    diff: (taskId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_DIFF, taskId),
    stat: (taskId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STAT, taskId),
    workingDiff: (taskId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_WORKING_DIFF, taskId),
    status: (taskId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_STATUS, taskId),
    resetFile: (taskId: string, filepath: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_RESET_FILE, taskId, filepath),
    clean: (taskId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_CLEAN, taskId),
    pull: (taskId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_PULL, taskId),
    log: (taskId: string): Promise<GitLogEntry[] | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_LOG, taskId),
    show: (taskId: string, hash: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_SHOW, taskId, hash),
    prChecks: (taskId: string): Promise<PRChecksResult | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_PR_CHECKS, taskId),
    // Source control (project-scoped)
    projectLog: (projectId: string, count?: number): Promise<GitLogEntry[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_PROJECT_LOG, projectId, count),
    branch: (projectId: string): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_BRANCH, projectId),
    commitDetail: (projectId: string, hash: string): Promise<GitCommitDetail> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMIT_DETAIL, projectId, hash),
    syncMain: (projectId: string): Promise<{ ok: boolean } | { error: string; hasConflicts: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.GIT_SYNC_MAIN, projectId),
  },

  // Dashboard operations
  dashboard: {
    stats: (): Promise<DashboardStats> =>
      ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_STATS),
  },

  // Debug Log operations
  debugLogs: {
    list: (filter?: AppDebugLogFilter): Promise<AppDebugLogEntry[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.DEBUG_LOG_LIST, filter),
    clear: (olderThanMs?: number): Promise<{ deleted: number }> =>
      ipcRenderer.invoke(IPC_CHANNELS.DEBUG_LOG_CLEAR, olderThanMs),
  },

  // Telegram operations
  telegram: {
    test: (botToken: string, chatId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TELEGRAM_TEST, botToken, chatId),
    startBot: (projectId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TELEGRAM_BOT_START, projectId),
    stopBot: (projectId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TELEGRAM_BOT_STOP, projectId),
    botStatus: (projectId: string): Promise<{ running: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.TELEGRAM_BOT_STATUS, projectId),
    botSession: (projectId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.TELEGRAM_BOT_SESSION, projectId),
  },

  // Chat operations
  chat: {
    send: (sessionId: string, message: string, images?: ChatImage[], mode?: string): Promise<{ userMessage: ChatMessage; sessionId: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND, sessionId, message, images, mode),
    stop: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_STOP, sessionId),
    messages: (sessionId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_MESSAGES, sessionId),
    clear: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_CLEAR, sessionId),
    summarize: (sessionId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SUMMARIZE, sessionId),
    costs: (): Promise<{ inputTokens: number; outputTokens: number }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_COSTS),
  },

  // Chat session operations
  chatSession: {
    create: (scopeType: 'project' | 'task', scopeId: string, name: string, agentLib?: string): Promise<ChatSession> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_CREATE, { scopeType, scopeId, name, agentLib }),
    list: (scopeType: 'project' | 'task', scopeId: string): Promise<ChatSession[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_LIST, scopeType, scopeId),
    listTaskSessions: (projectId: string): Promise<TaskChatSessionWithTitle[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_LIST_TASK_SESSIONS, projectId),
    update: (sessionId: string, input: { name?: string; agentLib?: string | null }): Promise<ChatSession | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_UPDATE, sessionId, input),
    delete: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SESSION_DELETE, sessionId),
    getAgentChatSession: (taskId: string, agentRole: string): Promise<ChatSession> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_AGENT_SESSION, taskId, agentRole),
    listAgents: (): Promise<RunningAgent[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_AGENTS_LIST),
  },

  // Automated Agent operations
  automatedAgents: {
    list: (projectId?: string): Promise<AutomatedAgent[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOMATED_AGENT_LIST, projectId),
    get: (id: string): Promise<AutomatedAgent | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOMATED_AGENT_GET, id),
    create: (input: AutomatedAgentCreateInput): Promise<AutomatedAgent> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOMATED_AGENT_CREATE, input),
    update: (id: string, input: AutomatedAgentUpdateInput): Promise<AutomatedAgent | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOMATED_AGENT_UPDATE, id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOMATED_AGENT_DELETE, id),
    trigger: (id: string): Promise<AgentRun> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOMATED_AGENT_TRIGGER, id),
    getRuns: (id: string, limit?: number): Promise<AgentRun[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOMATED_AGENT_RUNS, id, limit),
    listTemplates: (): Promise<AutomatedAgentTemplate[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTOMATED_AGENT_TEMPLATES),
  },

  // Shell operations
  shell: {
    openInChrome: (url: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_CHROME, url),
    openInIterm: (dirPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_ITERM, dirPath),
    openInVscode: (dirPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_VSCODE, dirPath),
    openFileInVscode: (filePath: string, line?: number): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE_IN_VSCODE, filePath, line),
  },

  // Event listeners (main -> renderer)
  on: {
    navigate: (callback: (path: string) => void) => {
      const listener = (_: IpcRendererEvent, path: string) => callback(path);
      ipcRenderer.on(IPC_CHANNELS.NAVIGATE, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.NAVIGATE, listener);
    },
    agentOutput: (callback: (taskId: string, chunk: string) => void) => {
      const listener = (_: IpcRendererEvent, taskId: string, chunk: string) => callback(taskId, chunk);
      ipcRenderer.on(IPC_CHANNELS.AGENT_OUTPUT, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_OUTPUT, listener);
    },
    agentInterruptedRuns: (callback: (runs: AgentRun[]) => void) => {
      const listener = (_: IpcRendererEvent, runs: AgentRun[]) => callback(runs);
      ipcRenderer.on(IPC_CHANNELS.AGENT_INTERRUPTED_RUNS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_INTERRUPTED_RUNS, listener);
    },
    agentMessage: (callback: (taskId: string, msg: AgentChatMessage) => void) => {
      const listener = (_: IpcRendererEvent, taskId: string, msg: AgentChatMessage) => callback(taskId, msg);
      ipcRenderer.on(IPC_CHANNELS.AGENT_MESSAGE, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_MESSAGE, listener);
    },
    agentStatus: (callback: (taskId: string, status: AgentRunStatus) => void) => {
      const listener = (_: IpcRendererEvent, taskId: string, status: AgentRunStatus) => callback(taskId, status);
      ipcRenderer.on(IPC_CHANNELS.AGENT_STATUS, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STATUS, listener);
    },
    chatOutput: (callback: (sessionId: string, chunk: string) => void) => {
      const listener = (_: IpcRendererEvent, sessionId: string, chunk: string) => callback(sessionId, chunk);
      ipcRenderer.on(IPC_CHANNELS.CHAT_OUTPUT, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_OUTPUT, listener);
    },
    chatMessage: (callback: (sessionId: string, msg: AgentChatMessage) => void) => {
      const listener = (_: IpcRendererEvent, sessionId: string, msg: AgentChatMessage) => callback(sessionId, msg);
      ipcRenderer.on(IPC_CHANNELS.CHAT_MESSAGE, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_MESSAGE, listener);
    },
    taskChatOutput: (callback: (sessionId: string, chunk: string) => void) => {
      const listener = (_: IpcRendererEvent, sessionId: string, chunk: string) => callback(sessionId, chunk);
      ipcRenderer.on(IPC_CHANNELS.TASK_CHAT_OUTPUT, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TASK_CHAT_OUTPUT, listener);
    },
    taskChatMessage: (callback: (sessionId: string, msg: AgentChatMessage) => void) => {
      const listener = (_: IpcRendererEvent, sessionId: string, msg: AgentChatMessage) => callback(sessionId, msg);
      ipcRenderer.on(IPC_CHANNELS.TASK_CHAT_MESSAGE, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TASK_CHAT_MESSAGE, listener);
    },
    telegramBotLog: (callback: (projectId: string, entry: TelegramBotLogEntry) => void) => {
      const listener = (_: IpcRendererEvent, projectId: string, entry: TelegramBotLogEntry) => callback(projectId, entry);
      ipcRenderer.on(IPC_CHANNELS.TELEGRAM_BOT_LOG, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TELEGRAM_BOT_LOG, listener);
    },
    telegramBotStatusChanged: (callback: (projectId: string, status: string) => void) => {
      const listener = (_: IpcRendererEvent, projectId: string, status: string) => callback(projectId, status);
      ipcRenderer.on(IPC_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, listener);
    },
    mainDiverged: (callback: (data: { projectId: string }) => void) => {
      const listener = (_: IpcRendererEvent, data: { projectId: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.MAIN_DIVERGED, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.MAIN_DIVERGED, listener);
    },
    chatSessionRenamed: (callback: (sessionId: string, session: ChatSession) => void) => {
      const listener = (_: IpcRendererEvent, sessionId: string, session: ChatSession) => callback(sessionId, session);
      ipcRenderer.on(IPC_CHANNELS.CHAT_SESSION_RENAMED, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_SESSION_RENAMED, listener);
    },
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('api', api);

// Type declaration for the renderer
export type ElectronAPI = typeof api;
