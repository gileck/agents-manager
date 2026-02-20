export interface ITelegramBotService {
  start(projectId: string): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}
