import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import { buildDesktopSystemPrompt } from '../../core/services/chat-prompt-parts';

export function taskChatRoutes(services: AppServices): Router {
  const router = Router();

  /**
   * Helper: find or create the default chat session for a task.
   * Lists existing task-scoped sessions and returns the first one,
   * or creates a new session if none exists.
   */
  async function getOrCreateTaskSession(taskId: string): Promise<string> {
    const sessions = await services.chatSessionStore.listSessionsForScope('task', taskId);
    if (sessions.length > 0) {
      return sessions[0].id;
    }
    // Derive projectId from the task
    const task = await services.taskStore.getTask(taskId);
    if (!task) throw new Error('Task not found');
    const session = await services.chatSessionStore.createSession({
      scopeType: 'task',
      scopeId: taskId,
      name: 'Task Chat',
      projectId: task.projectId,
    });
    return session.id;
  }

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
      if (message.length > 10000) {
        res.status(400).json({ error: 'Message is too long (max 10000 characters)' });
        return;
      }

      const sessionId = explicitSessionId || await getOrCreateTaskSession(taskId);
      const scope = await services.chatAgentService.getSessionScope(sessionId);
      const systemPrompt = buildDesktopSystemPrompt(scope);

      // TODO: Wire streaming callbacks (onEvent) via WebSocket in Phase 19
      const { userMessage } = await services.chatAgentService.send(
        sessionId,
        message,
        {
          systemPrompt,
          onEvent: () => {}, // placeholder — streaming wired in Phase 19
        },
      );

      res.json({ userMessage, sessionId });
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/chat/stop — stop generation
  router.post('/api/tasks/:taskId/chat/stop', async (req, res, next) => {
    try {
      const { sessionId } = req.body as { sessionId?: string };
      const resolvedSessionId = sessionId || await getOrCreateTaskSession(req.params.taskId);
      services.chatAgentService.stop(resolvedSessionId);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/chat/messages — get messages
  router.get('/api/tasks/:taskId/chat/messages', async (req, res, next) => {
    try {
      const { sessionId } = req.query as { sessionId?: string };
      const resolvedSessionId = sessionId || await getOrCreateTaskSession(req.params.taskId);
      const messages = await services.chatAgentService.getMessages(resolvedSessionId);
      res.json(messages);
    } catch (err) { next(err); }
  });

  return router;
}
