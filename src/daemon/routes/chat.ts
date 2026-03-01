import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import { buildDesktopSystemPrompt } from '../../core/services/chat-prompt-parts';
import type { WsHolder } from '../server';
import { WS_CHANNELS } from '../ws/channels';

export function chatRoutes(services: AppServices, wsHolder: WsHolder): Router {
  const router = Router();

  // POST /api/chat/sessions — create session
  router.post('/api/chat/sessions', async (req, res, next) => {
    try {
      const { scopeType, scopeId, name, agentLib } = req.body as {
        scopeType: string;
        scopeId: string;
        name: string;
        agentLib?: string;
      };
      if (!scopeType || (scopeType !== 'project' && scopeType !== 'task')) {
        res.status(400).json({ error: 'scopeType must be "project" or "task"' });
        return;
      }
      if (!scopeId) {
        res.status(400).json({ error: 'scopeId is required' });
        return;
      }
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'name is required and must be a non-empty string' });
        return;
      }
      if (name.length > 100) {
        res.status(400).json({ error: 'Session name must be 100 characters or less' });
        return;
      }

      // Verify the scope target exists and derive projectId
      let projectId: string;
      if (scopeType === 'project') {
        const project = await services.projectStore.getProject(scopeId);
        if (!project) {
          res.status(404).json({ error: 'Project not found' });
          return;
        }
        projectId = project.id;
      } else {
        const task = await services.taskStore.getTask(scopeId);
        if (!task) {
          res.status(404).json({ error: 'Task not found' });
          return;
        }
        projectId = task.projectId;
      }

      // Validate agentLib if provided
      if (agentLib) {
        const validLibs = services.agentLibRegistry.listNames();
        if (!validLibs.includes(agentLib)) {
          res.status(400).json({ error: `Unknown agent lib: ${agentLib}. Available: ${validLibs.join(', ')}` });
          return;
        }
      }

      const session = await services.chatSessionStore.createSession({
        scopeType: scopeType as 'project' | 'task',
        scopeId,
        name: name.trim(),
        agentLib,
        projectId,
      });
      res.status(201).json(session);
    } catch (err) { next(err); }
  });

  // GET /api/chat/sessions — list sessions for scope
  router.get('/api/chat/sessions', async (req, res, next) => {
    try {
      const { scopeType, scopeId } = req.query as { scopeType?: string; scopeId?: string };
      if (!scopeType || (scopeType !== 'project' && scopeType !== 'task')) {
        res.status(400).json({ error: 'scopeType query param must be "project" or "task"' });
        return;
      }
      if (!scopeId) {
        res.status(400).json({ error: 'scopeId query param is required' });
        return;
      }
      const sessions = await services.chatSessionStore.listSessionsForScope(
        scopeType as 'project' | 'task',
        scopeId,
        { excludeSources: ['telegram'] },
      );
      res.json(sessions);
    } catch (err) { next(err); }
  });

  // GET /api/chat/sessions/:id — get session
  router.get('/api/chat/sessions/:id', async (req, res, next) => {
    try {
      const session = await services.chatSessionStore.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json(session);
    } catch (err) { next(err); }
  });

  // DELETE /api/chat/sessions/:id — delete session
  router.delete('/api/chat/sessions/:id', async (req, res, next) => {
    try {
      const session = await services.chatSessionStore.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      // Stop any running agent for this session before deleting
      services.chatAgentService.stop(req.params.id);
      await services.chatSessionStore.deleteSession(req.params.id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /api/chat/sessions/:id/send — send message (streaming wired later)
  router.post('/api/chat/sessions/:id/send', async (req, res, next) => {
    try {
      const sessionId = req.params.id;
      const { message } = req.body as { message: string };
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

      const scope = await services.chatAgentService.getSessionScope(sessionId);
      const systemPrompt = buildDesktopSystemPrompt(scope);

      const ws = wsHolder.server;
      const { userMessage } = await services.chatAgentService.send(
        sessionId,
        message,
        {
          systemPrompt,
          onEvent: (event) => {
            if (event.type === 'text') ws?.broadcast(WS_CHANNELS.CHAT_OUTPUT, sessionId, event.text);
            else if (event.type === 'message') ws?.broadcast(WS_CHANNELS.CHAT_MESSAGE, sessionId, event.message);
          },
        },
      );

      res.json({ userMessage, sessionId });
    } catch (err) { next(err); }
  });

  // POST /api/chat/sessions/:id/stop — stop generation
  router.post('/api/chat/sessions/:id/stop', (_req, res) => {
    const sessionId = _req.params.id;
    services.chatAgentService.stop(sessionId);
    res.json({ ok: true });
  });

  // GET /api/chat/sessions/:id/messages — get messages
  router.get('/api/chat/sessions/:id/messages', async (req, res, next) => {
    try {
      const messages = await services.chatAgentService.getMessages(req.params.id);
      res.json(messages);
    } catch (err) { next(err); }
  });

  return router;
}
