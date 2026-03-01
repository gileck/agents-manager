import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import { TelegramAgentBotService } from '../../core/services/telegram-agent-bot-service';
import { TelegramNotificationRouter } from '../../core/services/telegram-notification-router';
import { validateTelegramConfig } from '../../core/services/telegram-config-validator';
import type { INotificationRouter } from '../../core/interfaces/notification-router';

/** Module-scoped active bots map shared across handler registrations */
const activeBots = new Map<string, {
  botService: TelegramAgentBotService;
  notificationRouter: INotificationRouter;
}>();

export function telegramRoutes(services: AppServices): Router {
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

      const project = await services.projectStore.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

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
        defaultPipelineId: services.settingsStore.get('default_pipeline_id', ''),
      });

      // TODO: Wire onLog, onOutput, onMessage via WebSocket in Phase 19
      await botService.start(projectId, botToken, chatId);

      const bot = botService.getBot()!;
      const telegramRouter = new TelegramNotificationRouter(bot, chatId);
      services.notificationRouter.addRouter(telegramRouter);

      activeBots.set(projectId, { botService, notificationRouter: telegramRouter });
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

  return router;
}
