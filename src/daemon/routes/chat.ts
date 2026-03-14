import * as path from 'path';
import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { WsHolder } from '../server';
import { WS_CHANNELS } from '../ws/channels';
import type { ChatImage, PermissionMode } from '../../shared/types';
import { MAX_MESSAGE_LENGTH } from '../../shared/constants';
import { getAppLogger } from '../../core/services/app-logger';

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VALID_PERMISSION_MODES = new Set<PermissionMode>(['read_only', 'read_write', 'full_access']);
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

  // GET /api/chat/images — serve a stored chat image by absolute path
  router.get('/api/chat/images', (req, res, next) => {
    try {
      const rawPath = req.query.path;
      if (typeof rawPath !== 'string' || !rawPath) {
        res.status(400).json({ error: 'path query param is required' });
        return;
      }
      const imageStorageDir = services.chatAgentService.getImageStorageDir();
      const resolved = path.resolve(rawPath);
      const storageRoot = path.resolve(imageStorageDir);
      if (!resolved.startsWith(storageRoot + path.sep) && resolved !== storageRoot) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      res.sendFile(resolved, { dotfiles: 'allow' }, (err) => {
        if (err) next(err);
      });
    } catch (err) { next(err); }
  });

  // GET /api/chat/agent-session — get or create agent-chat session for a task+role
  router.get('/api/chat/agent-session', async (req, res, next) => {
    try {
      const { taskId, agentRole } = req.query as { taskId?: string; agentRole?: string };
      if (!taskId || !agentRole) {
        res.status(400).json({ error: 'taskId and agentRole query params are required' });
        return;
      }
      const VALID_AGENT_ROLES = ['planner', 'designer', 'implementor', 'investigator', 'reviewer'];
      if (!VALID_AGENT_ROLES.includes(agentRole)) {
        res.status(400).json({ error: `Invalid agentRole: ${agentRole}. Must be one of: ${VALID_AGENT_ROLES.join(', ')}` });
        return;
      }
      const session = await services.chatAgentService.getOrCreateAgentChatSession(taskId, agentRole);
      res.json(session);
    } catch (err) { next(err); }
  });

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
      const { scopeType, scopeId, projectId } = req.query as { scopeType?: string; scopeId?: string; projectId?: string };
      if (!scopeType || (scopeType !== 'project' && scopeType !== 'task')) {
        res.status(400).json({ error: 'scopeType query param must be "project" or "task"' });
        return;
      }
      // Task sessions for a project (no scopeId): return all task-scoped sessions with task metadata
      if (scopeType === 'task' && !scopeId && projectId) {
        const sessions = await services.chatSessionStore.listTaskSessionsForProject(
          projectId,
          { excludeSources: ['telegram', 'agent-chat'] },
        );
        res.json(sessions);
        return;
      }
      if (!scopeId) {
        res.status(400).json({ error: 'scopeId query param is required' });
        return;
      }
      const sessions = await services.chatSessionStore.listSessionsForScope(
        scopeType as 'project' | 'task',
        scopeId,
        { excludeSources: ['telegram', 'agent-chat'] },
      );
      res.json(sessions);
    } catch (err) { next(err); }
  });

  // GET /api/chat/sessions/all — list all sessions for a project (incl. hidden), with message count
  router.get('/api/chat/sessions/all', async (req, res, next) => {
    try {
      const { projectId } = req.query as { projectId?: string };
      if (!projectId) {
        res.status(400).json({ error: 'projectId query param is required' });
        return;
      }
      const sessions = await services.chatSessionStore.listAllForProject(projectId);
      res.json(sessions);
    } catch (err) { next(err); }
  });

  // POST /api/chat/sessions/hide-all — soft-hide all sessions for a project
  router.post('/api/chat/sessions/hide-all', async (req, res, next) => {
    try {
      const { projectId } = req.body as { projectId?: string };
      if (!projectId) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      const ok = await services.chatSessionStore.hideAllSessions(projectId);
      res.json({ ok });
    } catch (err) { next(err); }
  });

  // PATCH /api/chat/sessions/:id/hide — soft-hide session from sidebar
  router.patch('/api/chat/sessions/:id/hide', async (req, res, next) => {
    try {
      const ok = await services.chatSessionStore.hideSession(req.params.id);
      res.json({ ok });
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
      if (message.length > MAX_MESSAGE_LENGTH) {
        res.status(400).json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH.toLocaleString()} characters)` });
        return;
      }

      getAppLogger().info('ChatRoute', `POST /send for session ${sessionId}`, { messageLength: message.length });

      const ws = wsHolder.server;

      // Auto-name session on first message if it still has a default name
      const [existingMessages, currentSession] = await Promise.all([
        services.chatAgentService.getMessages(sessionId),
        services.chatSessionStore.getSession(sessionId),
      ]);
      if (
        currentSession &&
        existingMessages.length === 0 &&
        (currentSession.name === 'General' || /^Session \d+$/.test(currentSession.name))
      ) {
        void services.chatAgentService.autoNameSession(sessionId, message, (updatedSession) => {
          ws?.broadcast(WS_CHANNELS.CHAT_SESSION_RENAMED, sessionId, updatedSession);
        });
      }

      // Build prompt + resume options via service (keeps business logic out of routes)
      const sendCtx = await services.chatAgentService.buildSendContext(sessionId);

      const { userMessage } = await services.chatAgentService.send(
        sessionId,
        message,
        {
          ...sendCtx,
          onEvent: (event) => {
            if (event.type === 'text') ws?.broadcast(WS_CHANNELS.CHAT_OUTPUT, sessionId, event.text);
            else if (event.type === 'message') ws?.broadcast(WS_CHANNELS.CHAT_MESSAGE, sessionId, event.message);
            else if (event.type === 'stream_delta') ws?.broadcast(WS_CHANNELS.CHAT_STREAM_DELTA, sessionId, event.delta);
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
      getAppLogger().info('ChatRoute', `POST /stop for session ${req.params.id}`);
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

  // GET /api/chat/sessions/:id/live-messages — get in-flight turn messages for a running agent
  router.get('/api/chat/sessions/:id/live-messages', (req, res, next) => {
    try {
      const msgs = services.chatAgentService.getLiveMessages(req.params.id);
      res.json(msgs);
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
      const input = req.body as { name?: string; agentLib?: string | null; model?: string | null; permissionMode?: string | null; systemPromptAppend?: string | null };
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
      const updateInput: { name?: string; agentLib?: string | null; model?: string | null; permissionMode?: PermissionMode | null; systemPromptAppend?: string | null } = {};
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
      if (input.model !== undefined) {
        if (input.model !== null && typeof input.model !== 'string') {
          res.status(400).json({ error: 'Model must be a string or null' });
          return;
        }
        if (input.model !== null) {
          // Validate model against the session's engine
          const engineName = input.agentLib ?? session.agentLib ?? 'claude-code';
          const validModels = services.agentLibRegistry.getModelsForLib(engineName);
          if (!validModels.some(m => m.value === input.model)) {
            res.status(400).json({ error: `Unknown model "${input.model}" for engine "${engineName}". Available: ${validModels.map(m => m.value).join(', ')}` });
            return;
          }
        }
        updateInput.model = input.model;
      }
      if (input.permissionMode !== undefined) {
        if (input.permissionMode !== null && !VALID_PERMISSION_MODES.has(input.permissionMode as PermissionMode)) {
          res.status(400).json({ error: `Invalid permissionMode: ${input.permissionMode}. Must be one of: ${[...VALID_PERMISSION_MODES].join(', ')}` });
          return;
        }
        updateInput.permissionMode = input.permissionMode as PermissionMode | null;
      }
      if (input.systemPromptAppend !== undefined) {
        if (input.systemPromptAppend !== null && typeof input.systemPromptAppend !== 'string') {
          res.status(400).json({ error: 'systemPromptAppend must be a string or null' });
          return;
        }
        if (input.systemPromptAppend !== null && input.systemPromptAppend.length > MAX_MESSAGE_LENGTH) {
          res.status(400).json({ error: `systemPromptAppend must be ${MAX_MESSAGE_LENGTH.toLocaleString()} characters or less` });
          return;
        }
        updateInput.systemPromptAppend = input.systemPromptAppend;
      }
      const updated = await services.chatSessionStore.updateSession(sessionId, updateInput);
      res.json(updated);
    } catch (err) { next(err); }
  });

  // POST /api/chat/sessions/:id/track-task — idempotently add a task to this session's tracked list
  router.post('/api/chat/sessions/:id/track-task', async (req, res, next) => {
    try {
      const { taskId } = req.body as { taskId?: string };
      if (!taskId || typeof taskId !== 'string') {
        res.status(400).json({ error: 'taskId is required' });
        return;
      }
      await services.chatSessionStore.addTrackedTask(req.params.id, taskId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // GET /api/chat/sessions/:id/tracked-tasks — return full task objects for all tracked task IDs
  router.get('/api/chat/sessions/:id/tracked-tasks', async (req, res, next) => {
    try {
      const taskIds = await services.chatSessionStore.getTrackedTaskIds(req.params.id);
      const tasks = await Promise.all(
        taskIds.map((id) => services.taskStore.getTask(id).catch(() => null)),
      );
      res.json(tasks.filter(Boolean));
    } catch (err) { next(err); }
  });

  // POST /api/chat/sessions/:id/answer-question — answer a pending AskUserQuestion
  router.post('/api/chat/sessions/:id/answer-question', (req, res, next) => {
    try {
      const sessionId = req.params.id;
      const { questionId, answers } = req.body as { questionId?: string; answers?: Record<string, string> };
      if (!questionId || typeof questionId !== 'string') {
        res.status(400).json({ error: 'questionId is required and must be a string' });
        return;
      }
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        res.status(400).json({ error: 'answers is required and must be a plain object' });
        return;
      }
      services.chatAgentService.answerQuestion(questionId, answers, sessionId);
      res.json({ ok: true });
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
