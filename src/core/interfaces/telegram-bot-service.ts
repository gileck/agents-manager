export interface ITelegramBotService {
  start(projectId: string, botToken: string, chatId: string): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}
