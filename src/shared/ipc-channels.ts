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

  /** PUSH-ONLY: main->renderer, do not invoke() */
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
  TASK_ALL_TRANSITIONS: 'task:all-transitions',
  TASK_FORCE_TRANSITION: 'task:force-transition',
  TASK_GUARD_CHECK: 'task:guard-check',
  TASK_HOOK_RETRY: 'task:hook-retry',
  TASK_PIPELINE_DIAGNOSTICS: 'task:pipeline-diagnostics',
  TASK_ADVANCE_PHASE: 'task:advance-phase',
  TASK_DISMISS_EVENT: 'task:dismiss-event',

  // Pipeline operations
  PIPELINE_LIST: 'pipeline:list',
  PIPELINE_GET: 'pipeline:get',

  // Agent operations
  AGENT_START: 'agent:start',
  AGENT_STOP: 'agent:stop',
  AGENT_RUNS: 'agent:runs',
  AGENT_GET: 'agent:get',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  AGENT_OUTPUT: 'agent:output',
  AGENT_ACTIVE_TASK_IDS: 'agent:active-task-ids',
  AGENT_ACTIVE_RUNS: 'agent:active-runs',
  AGENT_ALL_RUNS: 'agent:all-runs',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  AGENT_INTERRUPTED_RUNS: 'agent:interrupted-runs',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  AGENT_MESSAGE: 'agent:message',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  AGENT_STATUS: 'agent:status',
  AGENT_SEND_MESSAGE: 'agent:send-message',
  AGENT_COMPUTE_DIAGNOSTICS: 'agent:compute-diagnostics',

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
  TASK_ADD_CONTEXT_ENTRY: 'task:add-context-entry',
  TASK_ADD_FEEDBACK: 'task:add-feedback',

  // Task docs
  TASK_DOCS_LIST: 'task:docs:list',
  TASK_DOCS_GET: 'task:docs:get',
  TASK_DOCS_UPSERT: 'task:docs:upsert',

  // Debug timeline
  TASK_DEBUG_TIMELINE: 'task:debug-timeline',
  TASK_ERRORS: 'task:errors',
  TASK_CORRELATION_GROUPS: 'task:correlation-groups',

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
  AGENT_DEF_LIST_TYPES: 'agent-def:list-types',
  AGENT_DEF_EFFECTIVE: 'agent-def:effective',
  AGENT_DEF_INIT_FILES: 'agent-def:init-files',
  AGENT_DEF_DELETE_FILES: 'agent-def:delete-files',
  AGENT_DEF_UPDATE_PROMPT: 'agent-def:update-prompt',

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
  GIT_PR_CHECKS: 'git:pr-checks',
  GIT_SYNC_MAIN: 'git:sync-main',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  MAIN_DIVERGED: 'git:main-diverged',

  // Workflow review
  TASK_WORKFLOW_REVIEW: 'task:workflow-review',

  // Post-mortem review
  TASK_POST_MORTEM: 'task:post-mortem',

  // Dashboard
  DASHBOARD_STATS: 'dashboard:stats',

  // Telegram
  TELEGRAM_TEST: 'telegram:test',
  TELEGRAM_BOT_START: 'telegram:bot-start',
  TELEGRAM_BOT_STOP: 'telegram:bot-stop',
  TELEGRAM_BOT_STATUS: 'telegram:bot-status',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  TELEGRAM_BOT_LOG: 'telegram:bot-log',
  TELEGRAM_BOT_SESSION: 'telegram:bot-session',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  TELEGRAM_BOT_STATUS_CHANGED: 'telegram:bot-status-changed',

  // Shell
  OPEN_IN_CHROME: 'shell:open-in-chrome',
  OPEN_IN_ITERM: 'shell:open-in-iterm',
  OPEN_IN_VSCODE: 'shell:open-in-vscode',
  OPEN_FILE_IN_VSCODE: 'shell:open-file-in-vscode',

  // Dialog
  DIALOG_PICK_FOLDER: 'dialog:pick-folder',

  // Chat
  CHAT_SEND: 'chat:send',
  CHAT_STOP: 'chat:stop',
  CHAT_MESSAGES: 'chat:messages',
  CHAT_CLEAR: 'chat:clear',
  CHAT_SUMMARIZE: 'chat:summarize',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  CHAT_OUTPUT: 'chat:output',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  CHAT_MESSAGE: 'chat:message',
  /** PUSH-ONLY: main->renderer, do not invoke() – partial message streaming deltas */
  CHAT_STREAM_DELTA: 'chat:stream-delta',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  TASK_CHAT_OUTPUT: 'task-chat:output',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  TASK_CHAT_MESSAGE: 'task-chat:message',
  CHAT_COSTS: 'chat:costs',
  CHAT_LIVE_MESSAGES: 'chat:live-messages',

  // Chat sessions
  CHAT_SESSION_CREATE: 'chat:session:create',
  CHAT_SESSION_LIST: 'chat:session:list',
  CHAT_SESSION_LIST_TASK_SESSIONS: 'chat:session:list-task-sessions',
  CHAT_SESSION_UPDATE: 'chat:session:update',
  CHAT_SESSION_DELETE: 'chat:session:delete',
  CHAT_SESSION_HIDE: 'chat:session:hide',
  CHAT_SESSION_UNHIDE: 'chat:session:unhide',
  CHAT_SESSION_HIDE_ALL: 'chat:session:hide-all',
  CHAT_SESSION_LIST_ALL: 'chat:session:list-all',
  CHAT_AGENT_SESSION: 'chat:agent-session',
  CHAT_AGENTS_LIST: 'chat:agents:list',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  CHAT_SESSION_RENAMED: 'chat:session:renamed',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  CHAT_AGENT_NOTIFICATION: 'chat:agent-notification',

  // Source Control (project-scoped)
  GIT_PROJECT_LOG: 'git:project-log',
  GIT_BRANCH: 'git:branch',
  GIT_COMMIT_DETAIL: 'git:commit-detail',

  // Kanban Board operations
  KANBAN_BOARD_GET: 'kanban-board:get',
  KANBAN_BOARD_GET_BY_PROJECT: 'kanban-board:get-by-project',
  KANBAN_BOARD_LIST: 'kanban-board:list',
  KANBAN_BOARD_CREATE: 'kanban-board:create',
  KANBAN_BOARD_UPDATE: 'kanban-board:update',
  KANBAN_BOARD_DELETE: 'kanban-board:delete',

  // Agent Lib operations
  AGENT_LIB_LIST: 'agent-lib:list',
  AGENT_LIB_LIST_MODELS: 'agent-lib:list-models',
  AGENT_LIB_LIST_FEATURES: 'agent-lib:list-features',

  // Debug Log operations
  DEBUG_LOG_LIST: 'debug-log:list',
  DEBUG_LOG_CLEAR: 'debug-log:clear',

  // Automated Agent operations
  AUTOMATED_AGENT_LIST: 'automated-agent:list',
  AUTOMATED_AGENT_GET: 'automated-agent:get',
  AUTOMATED_AGENT_CREATE: 'automated-agent:create',
  AUTOMATED_AGENT_UPDATE: 'automated-agent:update',
  AUTOMATED_AGENT_DELETE: 'automated-agent:delete',
  AUTOMATED_AGENT_TRIGGER: 'automated-agent:trigger',
  AUTOMATED_AGENT_RUNS: 'automated-agent:runs',
  AUTOMATED_AGENT_TEMPLATES: 'automated-agent:templates',

  // Dev server operations
  DEV_SERVER_START: 'dev-server:start',
  DEV_SERVER_STOP: 'dev-server:stop',
  DEV_SERVER_STATUS: 'dev-server:status',
  DEV_SERVER_LIST: 'dev-server:list',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  DEV_SERVER_LOG: 'dev-server:log',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  DEV_SERVER_STATUS_CHANGED: 'dev-server:status-changed',

  // In-app notifications
  NOTIFICATION_LIST: 'notification:list',
  NOTIFICATION_MARK_READ: 'notification:mark-read',
  NOTIFICATION_MARK_ALL_READ: 'notification:mark-all-read',
  NOTIFICATION_UNREAD_COUNT: 'notification:unread-count',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  NOTIFICATION_ADDED: 'notification:added',

  /** PUSH-ONLY: main->renderer, do not invoke() */
  TASK_STATUS_CHANGED: 'task:status-changed',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  TASK_DELETED: 'task:deleted',

  // Chat session task tracking
  CHAT_TRACKED_TASKS: 'chat:tracked-tasks',
  CHAT_TRACK_TASK: 'chat:track-task',
  CHAT_UNTRACK_TASK: 'chat:untrack-task',

  // Chat question answering
  CHAT_ANSWER_QUESTION: 'chat:answer-question',

  // Chat session status polling
  CHAT_SESSION_STATUS: 'chat:session:status',

  // Worktree file operations
  WORKTREE_FILE_URL: 'worktree-file:url',
  WORKTREE_FILE_READ: 'worktree-file:read',

  // Screenshot operations
  SCREENSHOT_SAVE: 'screenshot:save',

  /** PUSH-ONLY: main->renderer, do not invoke() — permission request from agent */
  CHAT_PERMISSION_REQUEST: 'chat:permission-request',
  CHAT_PERMISSION_RESPONSE: 'chat:permission-response',
  /** PUSH-ONLY: main->renderer, do not invoke() — chat session status changed */
  CHAT_SESSION_STATUS_CHANGED: 'chat:session-status-changed',

  // Terminal operations
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_LIST: 'terminal:list',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_CLOSE: 'terminal:close',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  TERMINAL_OUTPUT: 'terminal:output',
  /** PUSH-ONLY: main->renderer, do not invoke() */
  TERMINAL_EXITED: 'terminal:exited',

  // Window management
  WINDOW_OPEN_PROJECT: 'window:open-project',
} as const;
