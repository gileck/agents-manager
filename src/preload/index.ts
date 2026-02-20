import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  Item, ItemCreateInput, ItemUpdateInput, AppSettings,
  Project, ProjectCreateInput, ProjectUpdateInput,
  Task, TaskCreateInput, TaskUpdateInput, TaskFilter,
  Feature, FeatureCreateInput, FeatureUpdateInput, FeatureFilter,
  Pipeline, Transition,
  AgentRun, AgentMode,
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
  Worktree,
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
  PIPELINE_LIST: 'pipeline:list',
  PIPELINE_GET: 'pipeline:get',
  AGENT_START: 'agent:start',
  AGENT_STOP: 'agent:stop',
  AGENT_RUNS: 'agent:runs',
  AGENT_GET: 'agent:get',
  AGENT_OUTPUT: 'agent:output',
  AGENT_ACTIVE_TASK_IDS: 'agent:active-task-ids',
  AGENT_ACTIVE_RUNS: 'agent:active-runs',
  AGENT_INTERRUPTED_RUNS: 'agent:interrupted-runs',
  EVENT_LIST: 'event:list',
  ACTIVITY_LIST: 'activity:list',
  PROMPT_LIST: 'prompt:list',
  PROMPT_RESPOND: 'prompt:respond',
  ARTIFACT_LIST: 'artifact:list',
  TASK_CONTEXT_ENTRIES: 'task:context-entries',
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
  TASK_WORKFLOW_REVIEW: 'task:workflow-review',
  DASHBOARD_STATS: 'dashboard:stats',
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
    reset: (id: string): Promise<Task | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_RESET, id),
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
    contextEntries: (taskId: string): Promise<TaskContextEntry[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_CONTEXT_ENTRIES, taskId),
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

  // Pipeline operations
  pipelines: {
    list: (): Promise<Pipeline[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.PIPELINE_LIST),
    get: (id: string): Promise<Pipeline | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.PIPELINE_GET, id),
  },

  // Agent operations
  agents: {
    start: (taskId: string, mode: AgentMode, agentType?: string): Promise<AgentRun> =>
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
  },

  // Dashboard operations
  dashboard: {
    stats: (): Promise<DashboardStats> =>
      ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_STATS),
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
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('api', api);

// Type declaration for the renderer
export type ElectronAPI = typeof api;
