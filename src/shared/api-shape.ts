/**
 * Shared type for the window.api surface exposed to the renderer.
 *
 * Both the Electron preload bridge and the web API shim implement this
 * interface. It is the single source of truth for what the renderer
 * can call — keep it in sync with src/preload/index.ts.
 *
 * This file contains ONLY types (no Electron imports) so it can be
 * safely imported from any compilation target.
 */

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
  ChatSessionWithDetails,
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
  InAppNotification,
  InAppNotificationFilter,
  PermissionMode,
  DevServerInfo,
} from './types';

export interface ApiShape {
  // Item operations (template)
  items: {
    list(): Promise<Item[]>;
    get(id: string): Promise<Item | null>;
    create(input: ItemCreateInput): Promise<Item>;
    update(id: string, input: ItemUpdateInput): Promise<Item | null>;
    delete(id: string): Promise<boolean>;
  };

  // Settings operations
  settings: {
    get(): Promise<AppSettings>;
    update(updates: Partial<AppSettings>): Promise<AppSettings>;
  };

  // App operations
  app: {
    getVersion(): Promise<string>;
  };

  // Project operations
  projects: {
    list(): Promise<Project[]>;
    get(id: string): Promise<Project | null>;
    create(input: ProjectCreateInput): Promise<Project>;
    update(id: string, input: ProjectUpdateInput): Promise<Project | null>;
    delete(id: string): Promise<boolean>;
  };

  // Task operations
  tasks: {
    list(filter?: TaskFilter): Promise<Task[]>;
    get(id: string): Promise<Task | null>;
    create(input: TaskCreateInput): Promise<Task>;
    update(id: string, input: TaskUpdateInput): Promise<Task | null>;
    delete(id: string): Promise<boolean>;
    reset(id: string, pipelineId?: string): Promise<Task | null>;
    transition(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult>;
    transitions(taskId: string): Promise<Transition[]>;
    dependencies(taskId: string): Promise<Task[]>;
    dependents(taskId: string): Promise<Task[]>;
    addDependency(taskId: string, dependsOnTaskId: string): Promise<void>;
    removeDependency(taskId: string, dependsOnTaskId: string): Promise<void>;
    allTransitions(taskId: string): Promise<AllTransitionsResult>;
    forceTransition(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult>;
    guardCheck(taskId: string, toStatus: string, trigger: TransitionTrigger): Promise<GuardCheckResult | null>;
    hookRetry(taskId: string, hookName: string, transitionFrom?: string, transitionTo?: string): Promise<HookRetryResult>;
    pipelineDiagnostics(taskId: string): Promise<PipelineDiagnostics | null>;
    advancePhase(taskId: string): Promise<TransitionResult>;
    contextEntries(taskId: string): Promise<TaskContextEntry[]>;
    addContextEntry(taskId: string, input: { source: string; entryType: string; summary: string; data?: Record<string, unknown> }): Promise<TaskContextEntry>;
    addFeedback(taskId: string, input: { entryType: string; content: string; source?: string; agentRunId?: string }): Promise<TaskContextEntry>;
    debugTimeline(taskId: string): Promise<DebugTimelineEntry[]>;
    worktree(taskId: string): Promise<Worktree | null>;
    workflowReview(taskId: string): Promise<AgentRun>;
  };

  // Feature operations
  features: {
    list(filter?: FeatureFilter): Promise<Feature[]>;
    get(id: string): Promise<Feature | null>;
    create(input: FeatureCreateInput): Promise<Feature>;
    update(id: string, input: FeatureUpdateInput): Promise<Feature | null>;
    delete(id: string): Promise<boolean>;
  };

  // Kanban Board operations
  kanbanBoards: {
    get(id: string): Promise<KanbanBoardConfig | null>;
    getByProject(projectId: string): Promise<KanbanBoardConfig | null>;
    list(projectId: string): Promise<KanbanBoardConfig[]>;
    create(input: KanbanBoardCreateInput): Promise<KanbanBoardConfig>;
    update(id: string, input: KanbanBoardUpdateInput): Promise<KanbanBoardConfig | null>;
    delete(id: string): Promise<boolean>;
  };

  // Agent definition operations
  agentDefinitions: {
    list(): Promise<AgentDefinition[]>;
    get(id: string): Promise<AgentDefinition | null>;
    create(input: AgentDefinitionCreateInput): Promise<AgentDefinition>;
    update(id: string, input: AgentDefinitionUpdateInput): Promise<AgentDefinition | null>;
    delete(id: string): Promise<boolean>;
  };

  // Agent lib operations
  agentLibs: {
    list(): Promise<{ name: string; available: boolean }[]>;
    listModels(): Promise<Record<string, { models: { value: string; label: string }[]; defaultModel: string }>>;
  };

  // Pipeline operations
  pipelines: {
    list(): Promise<Pipeline[]>;
    get(id: string): Promise<Pipeline | null>;
  };

  // Agent operations
  agents: {
    start(taskId: string, mode: AgentMode, agentType: string): Promise<AgentRun>;
    stop(runId: string): Promise<void>;
    runs(taskId: string): Promise<AgentRun[]>;
    get(runId: string): Promise<AgentRun | null>;
    activeTaskIds(): Promise<string[]>;
    activeRuns(): Promise<AgentRun[]>;
    allRuns(): Promise<AgentRun[]>;
    sendMessage(taskId: string, message: string): Promise<void>;
  };

  // Event operations
  events: {
    list(filter?: TaskEventFilter): Promise<TaskEvent[]>;
  };

  // Activity operations
  activity: {
    list(filter?: ActivityFilter): Promise<ActivityEntry[]>;
  };

  // Prompt operations
  prompts: {
    list(taskId: string): Promise<PendingPrompt[]>;
    respond(promptId: string, response: Record<string, unknown>): Promise<PendingPrompt | null>;
  };

  // Artifact operations
  artifacts: {
    list(taskId: string): Promise<TaskArtifact[]>;
  };

  // Git operations
  git: {
    diff(taskId: string): Promise<string | null>;
    stat(taskId: string): Promise<string | null>;
    workingDiff(taskId: string): Promise<string | null>;
    status(taskId: string): Promise<string | null>;
    resetFile(taskId: string, filepath: string): Promise<void>;
    clean(taskId: string): Promise<void>;
    pull(taskId: string): Promise<void>;
    log(taskId: string): Promise<GitLogEntry[] | null>;
    show(taskId: string, hash: string): Promise<string | null>;
    prChecks(taskId: string): Promise<PRChecksResult | null>;
    projectLog(projectId: string, count?: number): Promise<GitLogEntry[]>;
    branch(projectId: string): Promise<string>;
    commitDetail(projectId: string, hash: string): Promise<GitCommitDetail>;
    syncMain(projectId: string): Promise<{ ok: boolean } | { error: string; hasConflicts: boolean }>;
  };

  // Dashboard operations
  dashboard: {
    stats(): Promise<DashboardStats>;
  };

  // Debug Log operations
  debugLogs: {
    list(filter?: AppDebugLogFilter): Promise<AppDebugLogEntry[]>;
    clear(olderThanMs?: number): Promise<{ deleted: number }>;
  };

  // Telegram operations
  telegram: {
    test(botToken: string, chatId: string): Promise<void>;
    startBot(projectId: string): Promise<void>;
    stopBot(projectId: string): Promise<void>;
    botStatus(projectId: string): Promise<{ running: boolean }>;
    botSession(projectId: string): Promise<string | null>;
  };

  // Chat operations
  chat: {
    send(sessionId: string, message: string, images?: ChatImage[]): Promise<{ userMessage: ChatMessage; sessionId: string }>;
    stop(sessionId: string): Promise<void>;
    messages(sessionId: string): Promise<ChatMessage[]>;
    clear(sessionId: string): Promise<void>;
    summarize(sessionId: string): Promise<ChatMessage[]>;
    costs(): Promise<{ inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; totalCostUsd: number }>;
    chatLiveMessages(sessionId: string): Promise<AgentChatMessage[]>;
    trackedTasks(sessionId: string): Promise<Task[]>;
    trackTask(sessionId: string, taskId: string): Promise<void>;
    answerQuestion(sessionId: string, questionId: string, answers: Record<string, string>): Promise<void>;
  };

  // Chat session operations
  chatSession: {
    create(scopeType: 'project' | 'task', scopeId: string, name: string, agentLib?: string): Promise<ChatSession>;
    list(scopeType: 'project' | 'task', scopeId: string): Promise<ChatSession[]>;
    listTaskSessions(projectId: string): Promise<TaskChatSessionWithTitle[]>;
    listAll(projectId: string): Promise<ChatSessionWithDetails[]>;
    update(sessionId: string, input: { name?: string; agentLib?: string | null; permissionMode?: PermissionMode | null; systemPromptAppend?: string | null }): Promise<ChatSession | null>;
    delete(sessionId: string): Promise<boolean>;
    hide(sessionId: string): Promise<boolean>;
    hideAll(projectId: string): Promise<boolean>;
    getAgentChatSession(taskId: string, agentRole: string): Promise<ChatSession>;
    listAgents(): Promise<RunningAgent[]>;
  };

  // Automated Agent operations
  automatedAgents: {
    list(projectId?: string): Promise<AutomatedAgent[]>;
    get(id: string): Promise<AutomatedAgent | null>;
    create(input: AutomatedAgentCreateInput): Promise<AutomatedAgent>;
    update(id: string, input: AutomatedAgentUpdateInput): Promise<AutomatedAgent | null>;
    delete(id: string): Promise<boolean>;
    trigger(id: string): Promise<AgentRun>;
    getRuns(id: string, limit?: number): Promise<AgentRun[]>;
    listTemplates(): Promise<AutomatedAgentTemplate[]>;
  };

  // In-app notification operations
  notifications: {
    list(filter?: InAppNotificationFilter): Promise<InAppNotification[]>;
    markRead(id: string): Promise<void>;
    markAllRead(projectId?: string): Promise<void>;
    getUnreadCount(projectId?: string): Promise<{ count: number }>;
  };

  // Dev server operations
  devServers: {
    start(taskId: string): Promise<DevServerInfo>;
    stop(taskId: string): Promise<void>;
    status(taskId: string): Promise<DevServerInfo | null>;
    list(): Promise<DevServerInfo[]>;
  };

  // Screenshot operations
  screenshots: {
    save(images: ChatImage[]): Promise<{ paths: string[] }>;
  };

  // Shell operations
  shell: {
    openInChrome(url: string): Promise<void>;
    openInIterm(dirPath: string): Promise<void>;
    openInVscode(dirPath: string): Promise<void>;
    openFileInVscode(filePath: string, line?: number): Promise<void>;
  };

  // Dialog operations
  dialog: {
    pickFolder(): Promise<string | null>;
  };

  // Event listeners (push events from daemon)
  on: {
    navigate(callback: (path: string) => void): () => void;
    agentOutput(callback: (taskId: string, chunk: string) => void): () => void;
    agentInterruptedRuns(callback: (runs: AgentRun[]) => void): () => void;
    agentMessage(callback: (taskId: string, msg: AgentChatMessage) => void): () => void;
    agentStatus(callback: (taskId: string, status: AgentRunStatus) => void): () => void;
    chatOutput(callback: (sessionId: string, chunk: string) => void): () => void;
    chatMessage(callback: (sessionId: string, msg: AgentChatMessage) => void): () => void;
    chatStreamDelta(callback: (sessionId: string, delta: AgentChatMessage) => void): () => void;
    taskChatOutput(callback: (sessionId: string, chunk: string) => void): () => void;
    taskChatMessage(callback: (sessionId: string, msg: AgentChatMessage) => void): () => void;
    telegramBotLog(callback: (projectId: string, entry: TelegramBotLogEntry) => void): () => void;
    telegramBotStatusChanged(callback: (projectId: string, status: string) => void): () => void;
    mainDiverged(callback: (data: { projectId: string }) => void): () => void;
    chatSessionRenamed(callback: (sessionId: string, session: ChatSession) => void): () => void;
    notificationAdded(callback: (notification: InAppNotification) => void): () => void;
    devServerLog(callback: (taskId: string, data: { line: string }) => void): () => void;
    devServerStatus(callback: (taskId: string, info: DevServerInfo) => void): () => void;
    taskStatusChanged(callback: (taskId: string, task: Task) => void): () => void;
  };
}
