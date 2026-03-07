/**
 * Validates Telegram bot configuration parameters.
 * Shared between IPC handlers and CLI commands to avoid duplicated validation logic.
 */
export function validateTelegramConfig(
  botToken: string | undefined,
  chatId: string | undefined,
  notificationChatId?: string | undefined,
): { botToken: string; chatId: string; notificationChatId?: string } {
  if (!botToken || !chatId) {
    throw new Error('Telegram bot token and chat ID are required. Configure them in project settings.');
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    throw new Error('Invalid Telegram bot token format. Expected format: <number>:<alphanumeric-string>.');
  }
  if (!/^-?\d+$/.test(chatId)) {
    throw new Error('Invalid Telegram chat ID format. Expected a numeric value (optionally prefixed with -).');
  }
  if (notificationChatId && !/^-?\d+$/.test(notificationChatId)) {
    throw new Error('Invalid Telegram notification chat ID format. Expected a numeric value (optionally prefixed with -).');
  }
  return { botToken, chatId, notificationChatId: notificationChatId || undefined };
}
