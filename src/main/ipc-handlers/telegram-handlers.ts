import { app } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId } from '@template/main/ipc/ipc-registry';
import { sendToRenderer } from '@template/main/core/window';
import type { AppServices } from '../providers/setup';
import type { TelegramBotLogEntry } from '../../shared/types';
import { TelegramAgentBotService } from '../services/telegram-agent-bot-service';
import { TelegramNotificationRouter } from '../services/telegram-notification-router';
import type { INotificationRouter } from '../interfaces/notification-router';
import { validateTelegramConfig } from '../services/telegram-config-validator';

/** Module-scoped active bots map shared across handler registrations */
const activeBots = new Map<string, { botService: TelegramAgentBotService; notificationRouter: INotificationRouter }>();

/** Guard against double-registration of the before-quit listener */
let quitListenerRegistered = false;

export function registerTelegramHandlers(services: AppServices): void {
  if (!quitListenerRegistered) {
    quitListenerRegistered = true;
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
  }

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_START, async (_, projectId: string) => {
    validateId(projectId);
    if (activeBots.has(projectId)) {
      return; // Already running
    }
    const project = await services.projectStore.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const tg = (project.config?.telegram as Record<string, unknown>) ?? {};
    const { botToken, chatId } = validateTelegramConfig(
      tg.botToken as string | undefined,
      tg.chatId as string | undefined,
    );

    const botService = new TelegramAgentBotService({
      taskStore: services.taskStore,
      projectStore: services.projectStore,
      pipelineStore: services.pipelineStore,
      pipelineEngine: services.pipelineEngine,
      workflowService: services.workflowService,
      chatMessageStore: services.chatMessageStore,
      chatSessionStore: services.chatSessionStore,
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
