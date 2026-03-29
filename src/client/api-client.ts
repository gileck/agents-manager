/**
 * Typed API client for the agents-manager daemon.
 *
 * Covers every REST endpoint exposed by the daemon routes.
 * Uses native `fetch` (Node 18+ / Electron).
 */

import type {
  Project, ProjectCreateInput, ProjectUpdateInput,
  Task, TaskCreateInput, TaskUpdateInput, TaskFilter,
  Pipeline,
  Feature, FeatureCreateInput, FeatureUpdateInput, FeatureFilter,
  Item, ItemCreateInput, ItemUpdateInput,
  AppSettings,
  TaskEventFilter, ActivityFilter,
  AgentMode, RevisionReason,
  KanbanBoardCreateInput, KanbanBoardUpdateInput,
  AgentDefinitionCreateInput, AgentDefinitionUpdateInput,
  AppDebugLogEntry, AppDebugLogFilter,
  PRChecksResult,
  AutomatedAgent, AutomatedAgentCreateInput, AutomatedAgentUpdateInput, AutomatedAgentTemplate,
  AgentRun,
  TaskChatSessionWithTitle,
  InAppNotification, InAppNotificationFilter,
  DevServerInfo,
  ChatImage,
  TaskDoc,
  DocArtifactType,
  EffectiveAgentConfig,
  AgentFileInitResult,
} from '../shared/types';

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function buildRequest<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): () => Promise<T> {
  return async () => {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, (err as Record<string, string>).error || `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as T;
  };
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ApiClient {
  // Health & lifecycle
  health(): Promise<{ status: string; uptime: number }>;
  shutdown(): Promise<void>;

  // Projects
  projects: {
    list(): Promise<Project[]>;
    get(id: string): Promise<Project>;
    create(input: ProjectCreateInput): Promise<Project>;
    update(id: string, input: ProjectUpdateInput): Promise<Project>;
    delete(id: string): Promise<void>;
  };

  // Tasks
  tasks: {
    list(filter?: TaskFilter): Promise<Task[]>;
    get(id: string): Promise<Task>;
    create(input: TaskCreateInput): Promise<Task>;
    update(id: string, input: TaskUpdateInput): Promise<Task>;
    delete(id: string): Promise<void>;
    reset(id: string, pipelineId?: string): Promise<Task>;
    transition(id: string, toStatus: string, actor?: string): Promise<unknown>;
    forceTransition(id: string, toStatus: string, actor?: string): Promise<unknown>;
    getTransitions(id: string): Promise<unknown>;
    getAllTransitions(id: string): Promise<unknown>;
    guardCheck(id: string, toStatus: string, trigger: string): Promise<unknown>;
    getPipelineDiagnostics(id: string): Promise<unknown>;
    retryHook(id: string, hookName: string, transitionFrom?: string, transitionTo?: string): Promise<unknown>;
    advancePhase(id: string): Promise<unknown>;
    dismissEvent(id: string, eventId: string): Promise<void>;
    getDependencies(id: string): Promise<unknown[]>;
    getDependents(id: string): Promise<unknown[]>;
    addDependency(id: string, dependsOnTaskId: string): Promise<unknown>;
    removeDependency(id: string, depId: string): Promise<void>;
    getPrompts(id: string): Promise<unknown[]>;
    getContext(id: string): Promise<unknown[]>;
    addContext(id: string, input: { source: string; entryType: string; summary: string; data?: Record<string, unknown> }): Promise<unknown>;
    addFeedback(id: string, input: { entryType: string; content: string; source?: string; agentRunId?: string }): Promise<unknown>;
    getWorktree(id: string): Promise<unknown>;
    getArtifacts(id: string): Promise<unknown[]>;
    getTimeline(id: string): Promise<unknown>;
  };

  // Agents
  agents: {
    start(taskId: string, mode: AgentMode, agentType: string, revisionReason?: RevisionReason): Promise<unknown>;
    stop(taskId: string, runId: string): Promise<unknown>;
    message(taskId: string, message: string): Promise<unknown>;
    runs(taskId: string): Promise<unknown[]>;
    workflowReview(taskId: string): Promise<unknown>;
    postMortem(taskId: string, input?: { postMortemInput?: string; linkedBugDescriptions?: string[] }): Promise<unknown>;
    getRun(runId: string): Promise<unknown>;
    getActiveRuns(): Promise<unknown[]>;
    getActiveTaskIds(): Promise<string[]>;
    getAllRuns(): Promise<unknown[]>;
    computeDiagnostics(runId: string): Promise<unknown>;
  };

  // Pipelines
  pipelines: {
    list(): Promise<Pipeline[]>;
    get(id: string): Promise<Pipeline>;
  };

  // Features
  features: {
    list(filter?: FeatureFilter): Promise<Feature[]>;
    get(id: string): Promise<Feature>;
    create(input: FeatureCreateInput): Promise<Feature>;
    update(id: string, input: FeatureUpdateInput): Promise<Feature>;
    delete(id: string): Promise<void>;
  };

  // Kanban boards
  kanban: {
    listBoards(projectId: string): Promise<unknown[]>;
    getBoardByProject(projectId: string): Promise<unknown>;
    getBoard(id: string): Promise<unknown>;
    createBoard(input: KanbanBoardCreateInput): Promise<unknown>;
    updateBoard(id: string, input: KanbanBoardUpdateInput): Promise<unknown>;
    deleteBoard(id: string): Promise<void>;
  };

  // Agent definitions
  agentDefinitions: {
    list(): Promise<unknown[]>;
    get(id: string): Promise<unknown>;
    create(input: AgentDefinitionCreateInput): Promise<unknown>;
    update(id: string, input: AgentDefinitionUpdateInput): Promise<unknown>;
    delete(id: string): Promise<void>;
    listLibs(): Promise<unknown[]>;
    listModels(): Promise<unknown>;
    listFeatures(): Promise<unknown>;
    // File-based agent config (.agents/)
    listTypes(): Promise<string[]>;
    getEffective(agentType: string, projectId: string, mode?: AgentMode, revisionReason?: RevisionReason): Promise<EffectiveAgentConfig>;
    initFiles(agentType: string, projectId: string, force?: boolean): Promise<AgentFileInitResult>;
    deleteFiles(agentType: string, projectId: string): Promise<{ deleted: string[] }>;
    updatePrompt(agentType: string, projectId: string, content: string): Promise<{ path: string }>;
  };

  // Task docs
  taskDocs: {
    list(taskId: string): Promise<TaskDoc[]>;
    get(taskId: string, type: DocArtifactType): Promise<TaskDoc | null>;
    upsert(taskId: string, type: DocArtifactType, content: string, summary?: string | null): Promise<TaskDoc>;
  };

  // Items (template scaffold)
  items: {
    list(): Promise<Item[]>;
    get(id: string): Promise<Item>;
    create(input: ItemCreateInput): Promise<Item>;
    update(id: string, input: ItemUpdateInput): Promise<Item>;
    delete(id: string): Promise<void>;
  };

  // Settings
  settings: {
    get(): Promise<AppSettings>;
    update(updates: Partial<AppSettings>): Promise<AppSettings>;
  };

  // Dashboard
  dashboard: {
    getStats(): Promise<unknown>;
  };

  // Prompts
  prompts: {
    getPending(taskId: string): Promise<unknown[]>;
    respond(promptId: string, response: Record<string, unknown>): Promise<unknown>;
  };

  // Events & Activity
  events: {
    list(filter?: TaskEventFilter): Promise<unknown[]>;
    listActivities(filter?: ActivityFilter): Promise<unknown[]>;
  };

  // Chat
  chat: {
    createSession(input: { scopeType: string; scopeId: string; name: string; agentLib?: string; threadIntent?: string }): Promise<unknown>;
    listSessions(scopeType: string, scopeId: string): Promise<unknown[]>;
    listTaskSessionsForProject(projectId: string): Promise<TaskChatSessionWithTitle[]>;
    listAllForProject(projectId: string): Promise<unknown[]>;
    getSession(id: string): Promise<unknown>;
    deleteSession(id: string): Promise<unknown>;
    hideSession(id: string): Promise<unknown>;
    unhideSession(id: string): Promise<unknown>;
    hideAllSessions(projectId: string): Promise<unknown>;
    updateSession(id: string, input: { name?: string; agentLib?: string | null; systemPromptAppend?: string | null; draft?: string | null }): Promise<unknown>;
    getAgentChatSession(taskId: string, agentRole: string): Promise<unknown>;
    sendMessage(sessionId: string, message: string, images?: unknown[]): Promise<unknown>;
    stopGeneration(sessionId: string): Promise<unknown>;
    getMessages(sessionId: string): Promise<unknown[]>;
    getLiveMessages(sessionId: string): Promise<unknown[]>;
    clearMessages(sessionId: string): Promise<unknown>;
    summarizeMessages(sessionId: string): Promise<unknown>;
    getCosts(): Promise<unknown>;
    getRunningAgents(): Promise<unknown[]>;
    sendPermissionResponse(sessionId: string, requestId: string, allowed: boolean): Promise<void>;
    getTrackedTasks(sessionId: string): Promise<Task[]>;
    trackTask(sessionId: string, taskId: string): Promise<void>;
    untrackTask(sessionId: string, taskId: string): Promise<void>;
    answerQuestion(sessionId: string, questionId: string, answers: Record<string, string>): Promise<void>;
    getSessionStatus(sessionId: string): Promise<{ status: import('../shared/types').ChatSessionStatus }>;
  };

  // Task Chat
  taskChat: {
    send(taskId: string, message: string, sessionId?: string): Promise<unknown>;
    stop(taskId: string, sessionId?: string): Promise<unknown>;
    getMessages(taskId: string, sessionId?: string): Promise<unknown[]>;
  };

  // Git
  git: {
    // Task-scoped git operations
    getDiff(taskId: string): Promise<{ diff: string } | null>;
    getLog(taskId: string): Promise<unknown>;
    getStatus(taskId: string): Promise<{ status: string } | null>;
    getStat(taskId: string): Promise<unknown>;
    getWorkingDiff(taskId: string): Promise<{ diff: string } | null>;
    resetFile(taskId: string, filepath: string): Promise<unknown>;
    clean(taskId: string): Promise<unknown>;
    pull(taskId: string, branch?: string): Promise<unknown>;
    showCommit(taskId: string, hash: string): Promise<unknown>;
    // PR operations
    getPRChecks(taskId: string): Promise<PRChecksResult | null>;
    // Project-scoped git operations
    getProjectLog(projectId: string, count?: number): Promise<unknown[]>;
    getProjectBranch(projectId: string): Promise<{ branch: string }>;
    getProjectCommit(projectId: string, hash: string): Promise<unknown>;
    syncMain(projectId: string): Promise<{ ok: boolean } | { error: string; hasConflicts: boolean }>;
  };

  // Debug Logs
  debugLogs: {
    list(filter?: AppDebugLogFilter): Promise<AppDebugLogEntry[]>;
    clear(olderThanMs?: number): Promise<{ deleted: number }>;
  };

  // Telegram
  telegram: {
    start(projectId: string): Promise<unknown>;
    stop(projectId: string): Promise<unknown>;
    getStatus(projectId: string): Promise<{ running: boolean }>;
    getSession(projectId: string): Promise<{ sessionId: string | null }>;
    test(botToken: string, chatId: string): Promise<unknown>;
  };

  // Automated Agents
  automatedAgents: {
    list(projectId?: string): Promise<AutomatedAgent[]>;
    get(id: string): Promise<AutomatedAgent>;
    create(input: AutomatedAgentCreateInput): Promise<AutomatedAgent>;
    update(id: string, input: AutomatedAgentUpdateInput): Promise<AutomatedAgent>;
    delete(id: string): Promise<void>;
    trigger(id: string): Promise<AgentRun>;
    getRuns(id: string, limit?: number): Promise<AgentRun[]>;
    listTemplates(): Promise<AutomatedAgentTemplate[]>;
  };

  // In-app notifications
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

  // Worktree file operations
  worktreeFile: {
    getUrl(taskId: string, path: string): string;
    read(taskId: string, path: string): Promise<string>;
  };

  // Screenshots
  screenshots: {
    save(images: ChatImage[]): Promise<{ paths: string[] }>;
  };

  // Terminal operations
  terminals: {
    create(projectId: string, name: string, cwd: string): Promise<unknown>;
    list(): Promise<unknown[]>;
    write(terminalId: string, data: string): Promise<void>;
    resize(terminalId: string, cols: number, rows: number): Promise<void>;
    close(terminalId: string): Promise<void>;
  };

  // Shell operations (OS-level commands)
  shell: {
    openInChrome(url: string): Promise<void>;
    openInIterm(dirPath: string): Promise<void>;
    openInVscode(dirPath: string): Promise<void>;
    openFileInVscode(filePath: string, line?: number): Promise<void>;
    pickFolder(): Promise<string | null>;
  };

  // App metadata
  app: {
    getVersion(): Promise<string>;
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createApiClient(baseUrl: string): ApiClient {
  function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    return buildRequest<T>(baseUrl, method, path, body)();
  }

  function qs(params: Record<string, string | number | boolean | null | undefined>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `?${parts.join('&')}` : '';
  }

  return {
    // -- Health & lifecycle --------------------------------------------------
    health: () => req('GET', '/api/health'),
    shutdown: () => req('POST', '/api/shutdown'),

    // -- Projects ------------------------------------------------------------
    projects: {
      list: () => req('GET', '/api/projects'),
      get: (id) => req('GET', `/api/projects/${id}`),
      create: (input) => req('POST', '/api/projects', input),
      update: (id, input) => req('PUT', `/api/projects/${id}`, input),
      delete: (id) => req('DELETE', `/api/projects/${id}`),
    },

    // -- Tasks ---------------------------------------------------------------
    tasks: {
      list: (filter?: TaskFilter) => {
        const q: Record<string, string | number | boolean | null | undefined> = {};
        if (filter) {
          if (filter.projectId) q.projectId = filter.projectId;
          if (filter.pipelineId) q.pipelineId = filter.pipelineId;
          if (filter.status) q.status = filter.status;
          if (filter.type) q.type = filter.type;
          if (filter.size) q.size = filter.size;
          if (filter.complexity) q.complexity = filter.complexity;
          if (filter.priority !== undefined) q.priority = filter.priority;
          if (filter.assignee) q.assignee = filter.assignee;
          if (filter.parentTaskId !== undefined) q.parentTaskId = filter.parentTaskId ?? '';
          if (filter.featureId !== undefined) q.featureId = filter.featureId ?? '';
          if (filter.tag) q.tag = filter.tag;
          if (filter.search) q.search = filter.search;
        }
        return req('GET', `/api/tasks${qs(q)}`);
      },
      get: (id) => req('GET', `/api/tasks/${id}`),
      create: (input) => req('POST', '/api/tasks', input),
      update: (id, input) => req('PUT', `/api/tasks/${id}`, input),
      delete: (id) => req('DELETE', `/api/tasks/${id}`),
      reset: (id, pipelineId?) => req('POST', `/api/tasks/${id}/reset`, pipelineId ? { pipelineId } : {}),
      transition: (id, toStatus, actor?) => req('POST', `/api/tasks/${id}/transition`, { toStatus, actor }),
      forceTransition: (id, toStatus, actor?) => req('POST', `/api/tasks/${id}/force-transition`, { toStatus, actor }),
      getTransitions: (id) => req('GET', `/api/tasks/${id}/transitions`),
      getAllTransitions: (id) => req('GET', `/api/tasks/${id}/all-transitions`),
      guardCheck: (id, toStatus, trigger) => req('POST', `/api/tasks/${id}/guard-check`, { toStatus, trigger }),
      getPipelineDiagnostics: (id) => req('GET', `/api/tasks/${id}/pipeline-diagnostics`),
      retryHook: (id, hookName, transitionFrom?, transitionTo?) =>
        req('POST', `/api/tasks/${id}/hook-retry`, { hookName, transitionFrom, transitionTo }),
      advancePhase: (id) => req('POST', `/api/tasks/${id}/advance-phase`),
      dismissEvent: (id, eventId) => req('POST', `/api/tasks/${id}/events/${eventId}/dismiss`),
      getDependencies: (id) => req('GET', `/api/tasks/${id}/dependencies`),
      getDependents: (id) => req('GET', `/api/tasks/${id}/dependents`),
      addDependency: (id, dependsOnTaskId) => req('POST', `/api/tasks/${id}/dependencies`, { dependsOnTaskId }),
      removeDependency: (id, depId) => req('DELETE', `/api/tasks/${id}/dependencies/${depId}`),
      getPrompts: (id) => req('GET', `/api/tasks/${id}/prompts`),
      getContext: (id) => req('GET', `/api/tasks/${id}/context`),
      addContext: (id, input) => req('POST', `/api/tasks/${id}/context`, input),
      addFeedback: (id: string, input: { entryType: string; content: string; source?: string }) => req('POST', `/api/tasks/${id}/feedback`, input),
      getWorktree: (id) => req('GET', `/api/tasks/${id}/worktree`),
      getArtifacts: (id) => req('GET', `/api/tasks/${id}/artifacts`),
      getTimeline: (id) => req('GET', `/api/tasks/${id}/timeline`),
    },

    // -- Agents --------------------------------------------------------------
    agents: {
      start: (taskId, mode, agentType, revisionReason?) =>
        req('POST', `/api/tasks/${taskId}/agent/start`, { mode, agentType, revisionReason }),
      stop: (taskId, runId) =>
        req('POST', `/api/tasks/${taskId}/agent/stop`, { runId }),
      message: (taskId, message) =>
        req('POST', `/api/tasks/${taskId}/agent/message`, { message }),
      runs: (taskId) =>
        req('GET', `/api/tasks/${taskId}/agent/runs`),
      workflowReview: (taskId) =>
        req('POST', `/api/tasks/${taskId}/agent/workflow-review`),
      postMortem: (taskId, input?) =>
        req('POST', `/api/tasks/${taskId}/agent/post-mortem`, input ?? {}),
      getRun: (runId) =>
        req('GET', `/api/agent-runs/${runId}`),
      getActiveRuns: () =>
        req('GET', '/api/agent-runs/active'),
      getActiveTaskIds: () =>
        req('GET', '/api/agent-runs/active-task-ids'),
      getAllRuns: () =>
        req('GET', '/api/agent-runs'),
      computeDiagnostics: (runId) =>
        req('POST', `/api/agent-runs/${runId}/diagnostics`),
    },

    // -- Pipelines -----------------------------------------------------------
    pipelines: {
      list: () => req('GET', '/api/pipelines'),
      get: (id) => req('GET', `/api/pipelines/${id}`),
    },

    // -- Features ------------------------------------------------------------
    features: {
      list: (filter?: FeatureFilter) => {
        const q: Record<string, string | undefined> = {};
        if (filter?.projectId) q.projectId = filter.projectId;
        return req('GET', `/api/features${qs(q)}`);
      },
      get: (id) => req('GET', `/api/features/${id}`),
      create: (input) => req('POST', '/api/features', input),
      update: (id, input) => req('PUT', `/api/features/${id}`, input),
      delete: (id) => req('DELETE', `/api/features/${id}`),
    },

    // -- Kanban boards -------------------------------------------------------
    kanban: {
      listBoards: (projectId) =>
        req('GET', `/api/kanban/boards${qs({ projectId })}`),
      getBoardByProject: (projectId) =>
        req('GET', `/api/kanban/boards/by-project/${projectId}`),
      getBoard: (id) =>
        req('GET', `/api/kanban/boards/${id}`),
      createBoard: (input) =>
        req('POST', '/api/kanban/boards', input),
      updateBoard: (id, input) =>
        req('PUT', `/api/kanban/boards/${id}`, input),
      deleteBoard: (id) =>
        req('DELETE', `/api/kanban/boards/${id}`),
    },

    // -- Agent definitions ---------------------------------------------------
    agentDefinitions: {
      list: () => req('GET', '/api/agent-definitions'),
      get: (id) => req('GET', `/api/agent-definitions/${id}`),
      create: (input) => req('POST', '/api/agent-definitions', input),
      update: (id, input) => req('PUT', `/api/agent-definitions/${id}`, input),
      delete: (id) => req('DELETE', `/api/agent-definitions/${id}`),
      listLibs: () => req('GET', '/api/agent-libs'),
      listModels: () => req('GET', '/api/agent-libs/models'),
      listFeatures: () => req('GET', '/api/agent-libs/features'),
      // File-based agent config (.agents/)
      listTypes: () => req('GET', '/api/agent-definitions/types/list'),
      getEffective: (agentType, projectId, mode?, revisionReason?) =>
        req('GET', `/api/agent-definitions/${agentType}/effective${qs({ projectId, mode, revisionReason })}`),
      initFiles: (agentType, projectId, force?) =>
        req('POST', `/api/agent-definitions/${agentType}/init${qs({ projectId })}`, force ? { force: true } : {}),
      deleteFiles: (agentType, projectId) =>
        req('DELETE', `/api/agent-definitions/${agentType}/file-config${qs({ projectId })}`),
      updatePrompt: (agentType, projectId, content) =>
        req('PUT', `/api/agent-definitions/${agentType}/prompt${qs({ projectId })}`, { content }),
    },

    // -- Task Docs -----------------------------------------------------------
    taskDocs: {
      list: (taskId: string) => req('GET', `/api/tasks/${taskId}/docs`),
      get: (taskId: string, type: DocArtifactType) => req('GET', `/api/tasks/${taskId}/docs/${type}`),
      upsert: (taskId: string, type: DocArtifactType, content: string, summary?: string | null) =>
        req('PUT', `/api/tasks/${taskId}/docs/${type}`, { content, summary }),
    },

    // -- Items (template scaffold) -------------------------------------------
    items: {
      list: () => req('GET', '/api/items'),
      get: (id) => req('GET', `/api/items/${id}`),
      create: (input) => req('POST', '/api/items', input),
      update: (id, input) => req('PUT', `/api/items/${id}`, input),
      delete: (id) => req('DELETE', `/api/items/${id}`),
    },

    // -- Settings ------------------------------------------------------------
    settings: {
      get: () => req('GET', '/api/settings'),
      update: (updates) => req('PATCH', '/api/settings', updates),
    },

    // -- Dashboard -----------------------------------------------------------
    dashboard: {
      getStats: () => req('GET', '/api/dashboard/stats'),
    },

    // -- Prompts -------------------------------------------------------------
    prompts: {
      getPending: (taskId) => req('GET', `/api/prompts/pending${qs({ taskId })}`),
      respond: (promptId, response) => req('POST', `/api/prompts/${promptId}/respond`, { response }),
    },

    // -- Events & Activity ---------------------------------------------------
    events: {
      list: (filter?: TaskEventFilter) => {
        const q: Record<string, string | number | undefined> = {};
        if (filter) {
          if (filter.taskId) q.taskId = filter.taskId;
          if (filter.category) q.category = filter.category;
          if (filter.severity) q.severity = filter.severity;
          if (filter.since !== undefined) q.since = filter.since;
          if (filter.until !== undefined) q.until = filter.until;
          if (filter.limit !== undefined) q.limit = filter.limit;
        }
        return req('GET', `/api/events${qs(q)}`);
      },
      listActivities: (filter?: ActivityFilter) => {
        const q: Record<string, string | number | undefined> = {};
        if (filter) {
          if (filter.action) q.action = filter.action;
          if (filter.entityType) q.entityType = filter.entityType;
          if (filter.entityId) q.entityId = filter.entityId;
          if (filter.projectId) q.projectId = filter.projectId;
          if (filter.since !== undefined) q.since = filter.since;
          if (filter.until !== undefined) q.until = filter.until;
          if (filter.limit !== undefined) q.limit = filter.limit;
        }
        return req('GET', `/api/activities${qs(q)}`);
      },
    },

    // -- Chat ----------------------------------------------------------------
    chat: {
      createSession: (input) => req('POST', '/api/chat/sessions', input),
      listSessions: (scopeType, scopeId) =>
        req('GET', `/api/chat/sessions${qs({ scopeType, scopeId })}`),
      listTaskSessionsForProject: (projectId) =>
        req('GET', `/api/chat/sessions${qs({ scopeType: 'task', projectId })}`),
      listAllForProject: (projectId) =>
        req('GET', `/api/chat/sessions/all${qs({ projectId })}`),
      getSession: (id) => req('GET', `/api/chat/sessions/${id}`),
      deleteSession: (id) => req('DELETE', `/api/chat/sessions/${id}`),
      hideSession: (id) => req('PATCH', `/api/chat/sessions/${id}/hide`),
      unhideSession: (id) => req('PATCH', `/api/chat/sessions/${id}/unhide`),
      hideAllSessions: (projectId) => req('POST', '/api/chat/sessions/hide-all', { projectId }),
      updateSession: (id, input) => req('PATCH', `/api/chat/sessions/${id}`, input),
      getAgentChatSession: (taskId, agentRole) =>
        req('GET', `/api/chat/agent-session${qs({ taskId, agentRole })}`),
      sendMessage: (sessionId, message, images?) =>
        req('POST', `/api/chat/sessions/${sessionId}/send`, { message, images }),
      stopGeneration: (sessionId) =>
        req('POST', `/api/chat/sessions/${sessionId}/stop`),
      getMessages: (sessionId) =>
        req('GET', `/api/chat/sessions/${sessionId}/messages`),
      getLiveMessages: (sessionId) =>
        req('GET', `/api/chat/sessions/${sessionId}/live-messages`),
      clearMessages: (sessionId) =>
        req('DELETE', `/api/chat/sessions/${sessionId}/messages`),
      summarizeMessages: (sessionId) =>
        req('POST', `/api/chat/sessions/${sessionId}/summarize`),
      getCosts: () => req('GET', '/api/chat/costs'),
      getRunningAgents: () => req('GET', '/api/chat/agents'),
      sendPermissionResponse: (sessionId, requestId, allowed) =>
        req('POST', `/api/chat/sessions/${sessionId}/permission-response`, { requestId, allowed }),
      getTrackedTasks: (sessionId) => req('GET', `/api/chat/sessions/${sessionId}/tracked-tasks`),
      trackTask: (sessionId, taskId) => req('POST', `/api/chat/sessions/${sessionId}/track-task`, { taskId }),
      untrackTask: (sessionId, taskId) => req('DELETE', `/api/chat/sessions/${sessionId}/track-task/${taskId}`),
      answerQuestion: (sessionId, questionId, answers) =>
        req('POST', `/api/chat/sessions/${sessionId}/answer-question`, { questionId, answers }),
      getSessionStatus: (sessionId) => req('GET', `/api/chat/sessions/${sessionId}/status`),
    },

    // -- Task Chat -----------------------------------------------------------
    taskChat: {
      send: (taskId, message, sessionId?) =>
        req('POST', `/api/tasks/${taskId}/chat/send`, { message, sessionId }),
      stop: (taskId, sessionId?) =>
        req('POST', `/api/tasks/${taskId}/chat/stop`, { sessionId }),
      getMessages: (taskId, sessionId?) =>
        req('GET', `/api/tasks/${taskId}/chat/messages${qs({ sessionId })}`),
    },

    // -- Git -----------------------------------------------------------------
    git: {
      // Task-scoped
      getDiff: (taskId) => req('GET', `/api/tasks/${taskId}/git/diff`),
      getLog: (taskId) => req('GET', `/api/tasks/${taskId}/git/log`),
      getStatus: (taskId) => req('GET', `/api/tasks/${taskId}/git/status`),
      getStat: (taskId) => req('GET', `/api/tasks/${taskId}/git/stat`),
      getWorkingDiff: (taskId) => req('GET', `/api/tasks/${taskId}/git/working-diff`),
      resetFile: (taskId, filepath) =>
        req('POST', `/api/tasks/${taskId}/git/reset-file`, { filepath }),
      clean: (taskId) => req('POST', `/api/tasks/${taskId}/git/clean`),
      pull: (taskId, branch?) =>
        req('POST', `/api/tasks/${taskId}/git/pull`, branch ? { branch } : {}),
      showCommit: (taskId, hash) =>
        req('GET', `/api/tasks/${taskId}/git/show/${hash}`),
      // PR operations
      getPRChecks: (taskId) =>
        req('GET', `/api/tasks/${taskId}/pr/checks`),
      // Project-scoped
      getProjectLog: (projectId, count?) =>
        req('GET', `/api/projects/${projectId}/git/log${qs({ count })}`),
      getProjectBranch: (projectId) =>
        req('GET', `/api/projects/${projectId}/git/branch`),
      getProjectCommit: (projectId, hash) =>
        req('GET', `/api/projects/${projectId}/git/commit/${hash}`),
      syncMain: async (projectId) => {
        const res = await fetch(`${baseUrl}/api/projects/${projectId}/git/sync-main`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) return { ok: true as const };
        const body = await res.json().catch(() => ({ error: res.statusText, hasConflicts: false }));
        if (res.status === 409) return body as { error: string; hasConflicts: boolean };
        throw new ApiError(res.status, (body as Record<string, string>).error || `HTTP ${res.status}`);
      },
    },

    // -- Debug Logs ----------------------------------------------------------
    debugLogs: {
      list: (filter?: AppDebugLogFilter) => {
        const q: Record<string, string | number | undefined> = {};
        if (filter) {
          if (filter.level) q.level = filter.level;
          if (filter.source) q.source = filter.source;
          if (filter.search) q.search = filter.search;
          if (filter.since !== undefined) q.since = filter.since;
          if (filter.until !== undefined) q.until = filter.until;
          if (filter.limit !== undefined) q.limit = filter.limit;
        }
        return req('GET', `/api/debug-logs${qs(q)}`);
      },
      clear: (olderThanMs?: number) => {
        const q: Record<string, number | undefined> = {};
        if (olderThanMs !== undefined) q.olderThanMs = olderThanMs;
        return req('DELETE', `/api/debug-logs${qs(q)}`);
      },
    },

    // -- Telegram ------------------------------------------------------------
    telegram: {
      start: (projectId) => req('POST', '/api/telegram/start', { projectId }),
      stop: (projectId) => req('POST', '/api/telegram/stop', { projectId }),
      getStatus: (projectId) => req('GET', `/api/telegram/status${qs({ projectId })}`),
      getSession: (projectId) => req('GET', `/api/telegram/session${qs({ projectId })}`),
      test: (botToken, chatId) => req('POST', '/api/telegram/test', { botToken, chatId }),
    },

    // -- Automated Agents ----------------------------------------------------
    automatedAgents: {
      list: (projectId?) => req('GET', `/api/automated-agents${qs({ projectId })}`),
      get: (id) => req('GET', `/api/automated-agents/${id}`),
      create: (input) => req('POST', '/api/automated-agents', input),
      update: (id, input) => req('PUT', `/api/automated-agents/${id}`, input),
      delete: (id) => req('DELETE', `/api/automated-agents/${id}`),
      trigger: (id) => req('POST', `/api/automated-agents/${id}/trigger`),
      getRuns: (id, limit?) => req('GET', `/api/automated-agents/${id}/runs${qs({ limit })}`),
      listTemplates: () => req('GET', '/api/automated-agents/templates'),
    },

    // -- In-app notifications ------------------------------------------------
    notifications: {
      list: (filter?: InAppNotificationFilter) => {
        const q: Record<string, string | number | boolean | undefined> = {};
        if (filter?.projectId) q.projectId = filter.projectId;
        if (filter?.unreadOnly) q.unreadOnly = filter.unreadOnly;
        if (filter?.limit !== undefined) q.limit = filter.limit;
        return req('GET', `/api/notifications${qs(q)}`);
      },
      markRead: (id) => req('PUT', `/api/notifications/${id}/read`),
      markAllRead: (projectId?) => req('PUT', `/api/notifications/read-all${qs({ projectId })}`),
      getUnreadCount: (projectId?) => req('GET', `/api/notifications/unread-count${qs({ projectId })}`),
    },

    // -- Dev server operations -----------------------------------------------
    devServers: {
      start: (taskId) => req('POST', `/api/tasks/${taskId}/dev-server/start`),
      stop: (taskId) => req('POST', `/api/tasks/${taskId}/dev-server/stop`),
      status: (taskId) => req('GET', `/api/tasks/${taskId}/dev-server/status`),
      list: () => req('GET', '/api/dev-servers'),
    },

    // -- Worktree file operations ---------------------------------------------
    worktreeFile: {
      getUrl: (taskId, filePath) =>
        `${baseUrl}/api/worktree/${taskId}/file?path=${encodeURIComponent(filePath)}`,
      read: async (taskId, filePath) => {
        const url = `${baseUrl}/api/worktree/${taskId}/file?path=${encodeURIComponent(filePath)}`;
        const res = await fetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new ApiError(res.status, (err as Record<string, string>).error || `HTTP ${res.status}`);
        }
        return res.text();
      },
    },

    // -- Screenshots ---------------------------------------------------------
    screenshots: {
      save: (images) => req('POST', '/api/screenshots', { images }),
    },

    // -- Terminal operations ------------------------------------------------
    terminals: {
      create: (projectId: string, name: string, cwd: string) =>
        req('POST', '/api/terminals', { projectId, name, cwd }),
      list: () => req('GET', '/api/terminals'),
      write: (terminalId: string, data: string) =>
        req('POST', `/api/terminals/${terminalId}/write`, { data }),
      resize: (terminalId: string, cols: number, rows: number) =>
        req('POST', `/api/terminals/${terminalId}/resize`, { cols, rows }),
      close: (terminalId: string) =>
        req('DELETE', `/api/terminals/${terminalId}`),
    },

    // -- Shell operations ---------------------------------------------------
    shell: {
      openInChrome: (url) => req('POST', '/api/shell/open-in-chrome', { url }),
      openInIterm: (dirPath) => req('POST', '/api/shell/open-in-iterm', { dirPath }),
      openInVscode: (dirPath) => req('POST', '/api/shell/open-in-vscode', { dirPath }),
      openFileInVscode: (filePath, line?) => req('POST', '/api/shell/open-file-in-vscode', { filePath, line }),
      pickFolder: () => req<{ path: string | null }>('GET', '/api/shell/pick-folder').then(r => r.path),
    },

    // -- App metadata -------------------------------------------------------
    app: {
      getVersion: () => req<{ version: string }>('GET', '/api/app/version').then(r => r.version),
    },
  };
}

export { ApiError };
