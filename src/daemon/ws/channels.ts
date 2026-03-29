export const WS_CHANNELS = {
  AGENT_OUTPUT: 'agent:output',
  AGENT_MESSAGE: 'agent:message',
  AGENT_STATUS: 'agent:status',
  AGENT_INTERRUPTED_RUNS: 'agent:interrupted-runs',
  CHAT_OUTPUT: 'chat:output',
  CHAT_MESSAGE: 'chat:message',
  CHAT_STREAM_DELTA: 'chat:stream-delta',
  TASK_CHAT_OUTPUT: 'task-chat:output',
  TASK_CHAT_MESSAGE: 'task-chat:message',
  TELEGRAM_BOT_LOG: 'telegram:bot-log',
  TELEGRAM_BOT_STATUS_CHANGED: 'telegram:bot-status-changed',
  NAVIGATE: 'navigate',
  MAIN_DIVERGED: 'git:main-diverged',
  CHAT_SESSION_RENAMED: 'chat:session:renamed',
  NOTIFICATION_ADDED: 'notification:added',
  DEV_SERVER_LOG: 'dev-server:log',
  DEV_SERVER_STATUS: 'dev-server:status',
  /** PUSH-ONLY: broadcast when a task transitions to a new status */
  TASK_STATUS_CHANGED: 'task:status-changed',
  /** PUSH-ONLY: broadcast when a task is deleted */
  TASK_DELETED: 'task:deleted',
  /** PUSH-ONLY: notification sent to chat session when a subscribed pipeline agent finishes */
  CHAT_AGENT_NOTIFICATION: 'chat:agent-notification',
  /** PUSH-ONLY: permission request from agent needing user approval */
  CHAT_PERMISSION_REQUEST: 'chat:permission-request',
  /** PUSH-ONLY: broadcast when a chat session status changes */
  CHAT_SESSION_STATUS_CHANGED: 'chat:session-status-changed',
  /** PUSH-ONLY: terminal output data */
  TERMINAL_OUTPUT: 'terminal:output',
  /** PUSH-ONLY: terminal exited */
  TERMINAL_EXITED: 'terminal:exited',
} as const;
