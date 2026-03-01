import { app } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId } from '@template/main/ipc/ipc-registry';
import { sendToRenderer } from '@template/main/core/window';
import type { AppServices } from '../../core/providers/setup';
import type { TelegramBotLogEntry, AgentChatMessage } from '../../shared/types';
import { TelegramAgentBotService } from '../../core/services/telegram-agent-bot-service';
import { TelegramNotificationRouter } from '../../core/services/telegram-notification-router';
import type { INotificationRouter } from '../../core/interfaces/notification-router';
import { validateTelegramConfig } from '../../core/services/telegram-config-validator';

/** Module-scoped active bots map shared across handler registrations */
const activeBots = new Map<string, { botService: TelegramAgentBotService; notificationRouter: INotificationRouter }>();

/** Guard against double-registration of the before-quit listener */
let quitListenerRegistered = false;

async function startBotForProject(
  services: AppServices,
  projectId: string,
  botToken: string,
  chatId: string,
): Promise<void> {
  const botService = new TelegramAgentBotService({
    taskStore: services.taskStore,
    projectStore: services.projectStore,
    pipelineStore: services.pipelineStore,
    pipelineEngine: services.pipelineEngine,
    workflowService: services.workflowService,
    chatSessionStore: services.chatSessionStore,
    chatAgentService: services.chatAgentService,
    defaultPipelineId: services.settingsStore.get('default_pipeline_id', ''),
  });

  botService.onLog = (entry: TelegramBotLogEntry) => {
    sendToRenderer(IPC_CHANNELS.TELEGRAM_BOT_LOG, projectId, entry);
  };
  botService.onOutput = (sessionId: string, chunk: string) => {
    sendToRenderer(IPC_CHANNELS.CHAT_OUTPUT, sessionId, chunk);
  };
  botService.onMessage = (sessionId: string, msg: AgentChatMessage) => {
    sendToRenderer(IPC_CHANNELS.CHAT_MESSAGE, sessionId, msg);
  };

  await botService.start(projectId, botToken, chatId);

  const bot = botService.getBot()!;
  const telegramRouter = new TelegramNotificationRouter(bot, chatId);
  services.notificationRouter.addRouter(telegramRouter);

  activeBots.set(projectId, { botService, notificationRouter: telegramRouter });
  sendToRenderer(IPC_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, projectId, 'running');
}

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

    await startBotForProject(services, projectId, botToken, chatId);
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_STOP, async (_, projectId: string) => {
    validateId(projectId);
    const entry = activeBots.get(projectId);
    if (!entry) return;
    services.notificationRouter.removeRouter(entry.notificationRouter);
    await entry.botService.stop();
    activeBots.delete(projectId);
    sendToRenderer(IPC_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, projectId, 'stopped');
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_STATUS, async (_, projectId: string) => {
    validateId(projectId);
    const entry = activeBots.get(projectId);
    return { running: !!entry };
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_SESSION, async (_, projectId: string) => {
    validateId(projectId);
    const entry = activeBots.get(projectId);
    return entry?.botService.getSessionId() ?? null;
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

/**
 * Auto-start Telegram bots for all projects with enabled config.
 * Best-effort: logs errors per project, does not throw.
 * Note: sendToRenderer calls during startup may be lost if the renderer window
 * hasn't loaded yet. The renderer's initial poll via botStatus() is the reliable
 * source of truth at startup.
 */
export async function autoStartTelegramBots(services: AppServices): Promise<void> {
  const projects = await services.projectStore.listProjects();
  for (const project of projects) {
    const tg = (project.config?.telegram as Record<string, unknown>) ?? {};
    if (!tg.enabled || !tg.botToken || !tg.chatId) continue;
    if (activeBots.has(project.id)) continue;

    try {
      const { botToken, chatId } = validateTelegramConfig(
        tg.botToken as string | undefined,
        tg.chatId as string | undefined,
      );
      await startBotForProject(services, project.id, botToken, chatId);
    } catch (err) {
      console.error(`Failed to auto-start Telegram bot for project ${project.id}:`, err);
      sendToRenderer(IPC_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, project.id, 'failed');
    }
  }
}
