import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';

export function promptRoutes(services: AppServices): Router {
  const router = Router();

  // GET /api/prompts/pending — list pending prompts for a task
  router.get('/api/prompts/pending', async (req, res, next) => {
    try {
      const { taskId } = req.query as { taskId?: string };
      if (!taskId) {
        res.status(400).json({ error: 'taskId query param is required' });
        return;
      }
      const prompts = await services.pendingPromptStore.getPendingForTask(taskId);
      res.json(prompts);
    } catch (err) { next(err); }
  });

  // POST /api/prompts/:id/respond — respond to a pending prompt
  router.post('/api/prompts/:id/respond', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { response } = req.body as { response: Record<string, unknown> };
      if (!response || typeof response !== 'object') {
        res.status(400).json({ error: 'response object is required in request body' });
        return;
      }
      const result = await services.workflowService.respondToPrompt(id, response);
      if (!result) {
        res.status(404).json({ error: 'Prompt not found' });
        return;
      }
      res.json(result);
    } catch (err) { next(err); }
  });

  return router;
}
