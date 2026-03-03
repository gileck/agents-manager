import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import { TelegramAgentBotService } from '../../core/services/telegram-agent-bot-service';
import { TelegramNotificationRouter } from '../../core/services/telegram-notification-router';
import { validateTelegramConfig } from '../../core/services/telegram-config-validator';
import type { INotificationRouter } from '../../core/interfaces/notification-router';
import type { WsHolder } from '../server';
import { WS_CHANNELS } from '../ws/channels';
import { getAppLogger } from '../../core/services/app-logger';

/** Module-scoped active bots map shared across handler registrations */
const activeBots = new Map<string, {
  botService: TelegramAgentBotService;
  notificationRouter: INotificationRouter;
}>();

/** Stop all active Telegram bots — called during daemon shutdown. */
export async function stopAllBots(): Promise<void> {
  for (const [, entry] of activeBots) {
    try { await entry.botService.stop(); } catch (err) {
      getAppLogger().warn('telegram', 'Failed to stop bot', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  activeBots.clear();
}

/**
 * Start the Telegram bot for a project. Validates config, creates bot service,
 * wires WS callbacks, starts polling, and registers the notification router.
 * Skips silently if the bot is already running for this project.
 */
export async function startBotForProject(
  projectId: string, services: AppServices, wsHolder: WsHolder
): Promise<void> {
  if (activeBots.has(projectId)) return;

  const project = await services.projectStore.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

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
    chatSessionStore: services.chatSessionStore,
    chatAgentService: services.chatAgentService,
    agentRunStore: services.agentRunStore,
    defaultPipelineId: services.settingsStore.get('default_pipeline_id', ''),
  });

  // Wire streaming callbacks via WebSocket
  const ws = wsHolder.server;
  botService.onLog = (entry) => ws?.broadcast(WS_CHANNELS.TELEGRAM_BOT_LOG, projectId, entry);
  botService.onOutput = (sessionId, chunk) => ws?.broadcast(WS_CHANNELS.CHAT_OUTPUT, sessionId, chunk);
  botService.onMessage = (sessionId, msg) => ws?.broadcast(WS_CHANNELS.CHAT_MESSAGE, sessionId, msg);

  await botService.start(projectId, botToken, chatId);

  const bot = botService.getBot()!;
  const telegramRouter = new TelegramNotificationRouter(bot, chatId);
  services.notificationRouter.addRouter(telegramRouter);

  activeBots.set(projectId, { botService, notificationRouter: telegramRouter });
  ws?.broadcast(WS_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, projectId, 'running');
}

/**
 * Auto-start Telegram bots for all projects that have valid telegram config
 * and autoStart !== false. Called once during daemon startup.
 */
export async function autoStartTelegramBots(
  services: AppServices, wsHolder: WsHolder
): Promise<void> {
  const projects = await services.projectStore.listProjects();
  let started = 0;

  for (const project of projects) {
    const tg = (project.config?.telegram as Record<string, unknown>) ?? {};
    if (!tg.botToken || !tg.chatId) continue;
    if (tg.autoStart === false) continue;

    try {
      await startBotForProject(project.id, services, wsHolder);
      getAppLogger().info('telegram', `Auto-started bot for project "${project.name}"`);
      started++;
    } catch (err) {
      getAppLogger().logError('telegram', `Failed to auto-start bot for project "${project.name}"`, err);
      wsHolder.server?.broadcast(WS_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, project.id, 'failed');
    }
  }

  if (started > 0) {
    getAppLogger().info('telegram', `Auto-started ${started} bot(s)`);
  }
}

export function telegramRoutes(services: AppServices, wsHolder: WsHolder): Router {
  const router = Router();

  // POST /api/telegram/start — start bot for project
  router.post('/api/telegram/start', async (req, res, next) => {
    try {
      const { projectId } = req.body as { projectId: string };
      if (!projectId) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      if (activeBots.has(projectId)) {
        res.json({ ok: true, message: 'Bot already running' });
        return;
      }

      await startBotForProject(projectId, services, wsHolder);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /api/telegram/stop — stop bot for project
  router.post('/api/telegram/stop', async (req, res, next) => {
    try {
      const { projectId } = req.body as { projectId: string };
      if (!projectId) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }

      const entry = activeBots.get(projectId);
      if (!entry) {
        res.json({ ok: true, message: 'Bot not running' });
        return;
      }

      services.notificationRouter.removeRouter(entry.notificationRouter);
      await entry.botService.stop();
      activeBots.delete(projectId);
      const ws = wsHolder.server;
      ws?.broadcast(WS_CHANNELS.TELEGRAM_BOT_STATUS_CHANGED, projectId, 'stopped');
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/telegram/status — get bot status for project
  router.get('/api/telegram/status', (req, res) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param is required' });
      return;
    }
    const entry = activeBots.get(projectId);
    res.json({ running: !!entry });
  });

  // GET /api/telegram/session — get session ID for project bot
  router.get('/api/telegram/session', (req, res) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param is required' });
      return;
    }
    const entry = activeBots.get(projectId);
    res.json({ sessionId: entry?.botService.getSessionId() ?? null });
  });

  // POST /api/telegram/test — send test message
  router.post('/api/telegram/test', async (req, res, next) => {
    try {
      const { botToken, chatId } = req.body as { botToken?: string; chatId?: string };
      if (!botToken || !chatId) {
        res.status(400).json({ error: 'botToken and chatId are required' });
        return;
      }
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: 'Test notification from Agents Manager' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as Record<string, unknown>).description as string ?? `Telegram API error: ${response.status}`);
      }
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
}
