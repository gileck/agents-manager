import { app } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId } from '@template/main/ipc/ipc-registry';
import { sendToRenderer } from '@template/main/core/window';
import type { AppServices } from '../providers/setup';
import type { TelegramBotLogEntry } from '../../shared/types';
import { TelegramBotService } from '../services/telegram-bot-service';
import { TelegramNotificationRouter } from '../services/telegram-notification-router';
import type { INotificationRouter } from '../interfaces/notification-router';

export function registerTelegramHandlers(services: AppServices): void {
  const activeBots = new Map<string, { botService: TelegramBotService; notificationRouter: INotificationRouter }>();

  app.on('before-quit', async () => {
    for (const [, entry] of activeBots) {
      try {
        await entry.botService.stop();
      } catch {
        // ignore shutdown errors
      }
    }
    activeBots.clear();
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_START, async (_, projectId: string) => {
    validateId(projectId);
    if (activeBots.has(projectId)) {
      return; // Already running
    }
    const project = await services.projectStore.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const tg = (project.config?.telegram as Record<string, unknown>) ?? {};
    const botToken = tg.botToken as string | undefined;
    const chatId = tg.chatId as string | undefined;
    if (!botToken || !chatId) {
      throw new Error('Telegram bot token and chat ID are required. Configure them in project settings.');
    }
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
      throw new Error('Invalid Telegram bot token format. Expected format: <number>:<alphanumeric-string>.');
    }
    if (!/^-?\d+$/.test(chatId)) {
      throw new Error('Invalid Telegram chat ID format. Expected a numeric value (optionally prefixed with -).');
    }

    const botService = new TelegramBotService({
      taskStore: services.taskStore,
      projectStore: services.projectStore,
      pipelineStore: services.pipelineStore,
      pipelineEngine: services.pipelineEngine,
      workflowService: services.workflowService,
    });

    botService.onLog = (entry: TelegramBotLogEntry) => {
      sendToRenderer(IPC_CHANNELS.TELEGRAM_BOT_LOG, projectId, entry);
    };

    await botService.start(projectId, botToken, chatId);

    const bot = botService.getBot()!;
    const telegramRouter = new TelegramNotificationRouter(bot, chatId);
    services.notificationRouter.addRouter(telegramRouter);

    activeBots.set(projectId, { botService, notificationRouter: telegramRouter });
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_STOP, async (_, projectId: string) => {
    validateId(projectId);
    const entry = activeBots.get(projectId);
    if (!entry) return;
    services.notificationRouter.removeRouter(entry.notificationRouter);
    await entry.botService.stop();
    activeBots.delete(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_STATUS, async (_, projectId: string) => {
    validateId(projectId);
    const entry = activeBots.get(projectId);
    return { running: !!entry };
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_TEST, async (_, botToken: string, chatId: string) => {
    if (!botToken || !chatId) {
      throw new Error('Bot token and chat ID are required');
    }
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: 'Test notification from Agents Manager' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as Record<string, unknown>).description as string ?? `Telegram API error: ${res.status}`);
    }
  });
}
