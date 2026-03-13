import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import { buildDesktopSystemPrompt } from '../../core/services/chat-prompt-parts';
import type { WsHolder } from '../server';
import { WS_CHANNELS } from '../ws/channels';
import { MAX_MESSAGE_LENGTH } from '../../shared/constants';

export function taskChatRoutes(services: AppServices, wsHolder: WsHolder): Router {
  const router = Router();

  // POST /api/tasks/:taskId/chat/send — send message
  router.post('/api/tasks/:taskId/chat/send', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { message, sessionId: explicitSessionId } = req.body as {
        message: string;
        sessionId?: string;
      };
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'message is required and must be a string' });
        return;
      }
      if (!message.trim()) {
        res.status(400).json({ error: 'Message text is required' });
        return;
      }
      if (message.length > MAX_MESSAGE_LENGTH) {
        res.status(400).json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH.toLocaleString()} characters)` });
        return;
      }

      const sessionId = explicitSessionId || await services.chatAgentService.getOrCreateTaskSession(taskId);
      const scope = await services.chatAgentService.getSessionScope(sessionId);
      const systemPrompt = buildDesktopSystemPrompt(scope);

      const ws = wsHolder.server;
      const { userMessage } = await services.chatAgentService.send(
        sessionId,
        message,
        {
          systemPrompt,
          onEvent: (event) => {
            if (event.type === 'text') ws?.broadcast(WS_CHANNELS.TASK_CHAT_OUTPUT, sessionId, event.text);
            else if (event.type === 'message') ws?.broadcast(WS_CHANNELS.TASK_CHAT_MESSAGE, sessionId, event.message);
          },
        },
      );

      res.json({ userMessage, sessionId });
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/chat/stop — stop generation
  router.post('/api/tasks/:taskId/chat/stop', async (req, res, next) => {
    try {
      const { sessionId } = req.body as { sessionId?: string };
      const resolvedSessionId = sessionId || await services.chatAgentService.getOrCreateTaskSession(req.params.taskId);
      services.chatAgentService.stop(resolvedSessionId);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/chat/messages — get messages
  router.get('/api/tasks/:taskId/chat/messages', async (req, res, next) => {
    try {
      const { sessionId } = req.query as { sessionId?: string };
      const resolvedSessionId = sessionId || await services.chatAgentService.getOrCreateTaskSession(req.params.taskId);
      const messages = await services.chatAgentService.getMessages(resolvedSessionId);
      res.json(messages);
    } catch (err) { next(err); }
  });

  return router;
}
