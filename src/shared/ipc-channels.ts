// IPC channel names for type-safe communication

export const IPC_CHANNELS = {
  // Item operations (template)
  ITEM_LIST: 'item:list',
  ITEM_GET: 'item:get',
  ITEM_CREATE: 'item:create',
  ITEM_UPDATE: 'item:update',
  ITEM_DELETE: 'item:delete',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // App
  APP_GET_VERSION: 'app:get-version',

  // Navigation (main -> renderer)
  NAVIGATE: 'navigate',

  // Project operations
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',

  // Task operations
  TASK_LIST: 'task:list',
  TASK_GET: 'task:get',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  TASK_TRANSITION: 'task:transition',
  TASK_TRANSITIONS: 'task:transitions',
  TASK_DEPENDENCIES: 'task:dependencies',

  // Pipeline operations
  PIPELINE_LIST: 'pipeline:list',
  PIPELINE_GET: 'pipeline:get',

  // Agent operations
  AGENT_START: 'agent:start',
  AGENT_STOP: 'agent:stop',
  AGENT_RUNS: 'agent:runs',
  AGENT_GET: 'agent:get',
  AGENT_OUTPUT: 'agent:output',
  AGENT_ACTIVE_TASK_IDS: 'agent:active-task-ids',

  // Event operations
  EVENT_LIST: 'event:list',

  // Activity operations
  ACTIVITY_LIST: 'activity:list',

  // Prompt operations
  PROMPT_LIST: 'prompt:list',
  PROMPT_RESPOND: 'prompt:respond',

  // Artifact operations
  ARTIFACT_LIST: 'artifact:list',

  // Debug timeline
  TASK_DEBUG_TIMELINE: 'task:debug-timeline',

  // Dashboard
  DASHBOARD_STATS: 'dashboard:stats',
} as const;
