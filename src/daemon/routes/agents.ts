import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { AgentMode } from '../../shared/types';

export function agentRoutes(services: AppServices): Router {
  const router = Router();

  // POST /api/tasks/:taskId/agent/start — start agent
  router.post('/api/tasks/:taskId/agent/start', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { mode, agentType } = req.body as { mode: AgentMode; agentType?: string };
      if (!mode) {
        res.status(400).json({ error: 'mode is required' });
        return;
      }
      // TODO: Wire streaming callbacks (onOutput, onMessage, onStatusChange) in Phase 19
      const run = await services.workflowService.startAgent(
        taskId, mode, agentType,
        undefined, // revisionReason
        () => {},  // onOutput placeholder
        () => {},  // onMessage placeholder
        () => {},  // onStatusChange placeholder
      );
      res.json(run);
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/agent/stop — stop agent
  router.post('/api/tasks/:taskId/agent/stop', async (req, res, next) => {
    try {
      const { runId } = req.body as { runId: string };
      if (!runId) {
        res.status(400).json({ error: 'runId is required in request body' });
        return;
      }
      await services.workflowService.stopAgent(runId);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/agent/message — send message to running agent
  router.post('/api/tasks/:taskId/agent/message', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { message } = req.body as { message: string };
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'message is required and must be a string' });
        return;
      }
      // TODO: Wire streaming callbacks (onOutput, onMessage, onStatusChange) in Phase 19
      const run = await services.workflowService.resumeAgent(taskId, message, {
        onOutput: () => {},
        onMessage: () => {},
        onStatusChange: () => {},
      });
      res.json(run ?? { ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/agent/runs — list agent runs for task
  router.get('/api/tasks/:taskId/agent/runs', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const runs = await services.agentRunStore.getRunsForTask(taskId);
      res.json(runs);
    } catch (err) { next(err); }
  });

  return router;
}
