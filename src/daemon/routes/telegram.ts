import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';

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
      await services.telegramBotManager.startBot(projectId);
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
      await services.telegramBotManager.stopBot(projectId);
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
    res.json({ running: services.telegramBotManager.isRunning(projectId) });
  });

  // GET /api/telegram/session — get session ID for project bot
  router.get('/api/telegram/session', (req, res) => {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param is required' });
      return;
    }
    res.json({ sessionId: services.telegramBotManager.getSessionId(projectId) });
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
        const errorMessage = (body as Record<string, unknown>).description as string ?? `Telegram API error: ${response.status}`;
        res.json({ ok: false, error: errorMessage });
        return;
      }
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
}
