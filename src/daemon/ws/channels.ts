export const WS_CHANNELS = {
  AGENT_OUTPUT: 'agent:output',
  AGENT_MESSAGE: 'agent:message',
  AGENT_STATUS: 'agent:status',
  AGENT_INTERRUPTED_RUNS: 'agent:interrupted-runs',
  CHAT_OUTPUT: 'chat:output',
  CHAT_MESSAGE: 'chat:message',
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
  /** PUSH-ONLY: notification sent to chat session when a subscribed pipeline agent finishes */
  CHAT_AGENT_NOTIFICATION: 'chat:agent-notification',
} as const;
