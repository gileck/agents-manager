import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import { buildDesktopSystemPrompt } from '../../core/services/chat-prompt-parts';
import type { WsHolder } from '../server';
import { WS_CHANNELS } from '../ws/channels';
import type { ChatImage } from '../../shared/types';

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES_PER_MESSAGE = 5;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // ~10MB base64

function validateImages(images: unknown): ChatImage[] | undefined {
  if (images === undefined || images === null) return undefined;
  if (!Array.isArray(images)) throw new Error('images must be an array');
  if (images.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`Maximum ${MAX_IMAGES_PER_MESSAGE} images per message`);
  for (const img of images) {
    if (!img || typeof img !== 'object') throw new Error('Each image must be an object');
    if (!VALID_IMAGE_TYPES.has(img.mediaType)) throw new Error(`Invalid image type: ${img.mediaType}. Allowed: png, jpeg, gif, webp`);
    if (typeof img.base64 !== 'string' || img.base64.length === 0) throw new Error('Image base64 data is required');
    if (img.base64.length > MAX_IMAGE_SIZE_BYTES) throw new Error('Image too large (max ~10MB)');
  }
  return images as ChatImage[];
}

export function chatRoutes(services: AppServices, wsHolder: WsHolder): Router {
  const router = Router();

  // POST /api/chat/sessions — create session
  router.post('/api/chat/sessions', async (req, res, next) => {
    try {
      const session = await services.chatAgentService.createSession(req.body);
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
      const { message, images } = req.body as { message: string; images?: unknown };
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'message is required and must be a string' });
        return;
      }
      const validatedImages = validateImages(images);
      if (!message.trim() && !validatedImages?.length) {
        res.status(400).json({ error: 'Message text or images are required' });
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
          images: validatedImages,
        },
      );

      res.json({ userMessage, sessionId });
    } catch (err) { next(err); }
  });

  // POST /api/chat/sessions/:id/stop — stop generation
  router.post('/api/chat/sessions/:id/stop', (req, res, next) => {
    try {
      services.chatAgentService.stop(req.params.id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/chat/sessions/:id/messages — get messages
  router.get('/api/chat/sessions/:id/messages', async (req, res, next) => {
    try {
      const messages = await services.chatAgentService.getMessages(req.params.id);
      res.json(messages);
    } catch (err) { next(err); }
  });

  // DELETE /api/chat/sessions/:id/messages — clear messages
  router.delete('/api/chat/sessions/:id/messages', async (req, res, next) => {
    try {
      await services.chatAgentService.clearMessages(req.params.id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /api/chat/sessions/:id/summarize — summarize messages
  router.post('/api/chat/sessions/:id/summarize', async (req, res, next) => {
    try {
      const result = await services.chatAgentService.summarizeMessages(req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  });

  // PATCH /api/chat/sessions/:id — update session
  router.patch('/api/chat/sessions/:id', async (req, res, next) => {
    try {
      const sessionId = req.params.id;
      const input = req.body as { name?: string; agentLib?: string | null };
      if (!input || typeof input !== 'object') {
        res.status(400).json({ error: 'Invalid input: expected object' });
        return;
      }
      if (input.name !== undefined) {
        if (typeof input.name !== 'string') {
          res.status(400).json({ error: 'Session name must be a string' });
          return;
        }
        if (input.name.length > 100) {
          res.status(400).json({ error: 'Session name must be 100 characters or less' });
          return;
        }
        if (input.name.trim().length === 0) {
          res.status(400).json({ error: 'Session name cannot be empty' });
          return;
        }
      }
      // Verify session exists
      const session = await services.chatSessionStore.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const updateInput: { name?: string; agentLib?: string | null } = {};
      if (input.name !== undefined) updateInput.name = input.name.trim();
      if (input.agentLib !== undefined) {
        if (input.agentLib !== null) {
          const validLibs = services.agentLibRegistry.listNames();
          if (!validLibs.includes(input.agentLib)) {
            res.status(400).json({ error: `Unknown agent lib: ${input.agentLib}. Available: ${validLibs.join(', ')}` });
            return;
          }
        }
        updateInput.agentLib = input.agentLib;
      }
      const updated = await services.chatSessionStore.updateSession(sessionId, updateInput);
      res.json(updated);
    } catch (err) { next(err); }
  });

  // GET /api/chat/costs — get cost summary
  router.get('/api/chat/costs', async (_req, res, next) => {
    try {
      const costs = await services.chatMessageStore.getCostSummary();
      res.json(costs);
    } catch (err) { next(err); }
  });

  // GET /api/chat/agents — list running chat agents
  router.get('/api/chat/agents', async (_req, res, next) => {
    try {
      const agents = await services.chatAgentService.getRunningAgents();
      res.json(agents);
    } catch (err) { next(err); }
  });

  return router;
}
