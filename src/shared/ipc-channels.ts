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
  TASK_RESET: 'task:reset',
  TASK_TRANSITION: 'task:transition',
  TASK_TRANSITIONS: 'task:transitions',
  TASK_DEPENDENCIES: 'task:dependencies',
  TASK_DEPENDENTS: 'task:dependents',
  TASK_ADD_DEPENDENCY: 'task:add-dependency',
  TASK_REMOVE_DEPENDENCY: 'task:remove-dependency',

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
  AGENT_ACTIVE_RUNS: 'agent:active-runs',
  AGENT_INTERRUPTED_RUNS: 'agent:interrupted-runs',

  // Event operations
  EVENT_LIST: 'event:list',

  // Activity operations
  ACTIVITY_LIST: 'activity:list',

  // Prompt operations
  PROMPT_LIST: 'prompt:list',
  PROMPT_RESPOND: 'prompt:respond',

  // Artifact operations
  ARTIFACT_LIST: 'artifact:list',

  // Task context entries
  TASK_CONTEXT_ENTRIES: 'task:context-entries',

  // Debug timeline
  TASK_DEBUG_TIMELINE: 'task:debug-timeline',

  // Worktree
  TASK_WORKTREE: 'task:worktree',

  // Feature operations
  FEATURE_LIST: 'feature:list',
  FEATURE_GET: 'feature:get',
  FEATURE_CREATE: 'feature:create',
  FEATURE_UPDATE: 'feature:update',
  FEATURE_DELETE: 'feature:delete',

  // Agent definition operations
  AGENT_DEF_LIST: 'agent-def:list',
  AGENT_DEF_GET: 'agent-def:get',
  AGENT_DEF_CREATE: 'agent-def:create',
  AGENT_DEF_UPDATE: 'agent-def:update',
  AGENT_DEF_DELETE: 'agent-def:delete',

  // Git operations
  GIT_DIFF: 'git:diff',
  GIT_STAT: 'git:stat',
  GIT_WORKING_DIFF: 'git:working-diff',
  GIT_STATUS: 'git:status',
  GIT_RESET_FILE: 'git:reset-file',
  GIT_CLEAN: 'git:clean',
  GIT_PULL: 'git:pull',
  GIT_LOG: 'git:log',
  GIT_SHOW: 'git:show',

  // Workflow review
  TASK_WORKFLOW_REVIEW: 'task:workflow-review',

  // Dashboard
  DASHBOARD_STATS: 'dashboard:stats',

  // Telegram
  TELEGRAM_TEST: 'telegram:test',

  // Shell
  OPEN_IN_CHROME: 'shell:open-in-chrome',

  // Chat
  CHAT_SEND: 'chat:send',
  CHAT_STOP: 'chat:stop',
  CHAT_MESSAGES: 'chat:messages',
  CHAT_CLEAR: 'chat:clear',
  CHAT_SUMMARIZE: 'chat:summarize',
  CHAT_OUTPUT: 'chat:output',
} as const;
