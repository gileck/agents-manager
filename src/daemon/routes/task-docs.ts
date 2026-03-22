import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { DocArtifactType } from '../../shared/types';

export function taskDocRoutes(services: AppServices): Router {
  const router = Router();

  // List all docs for a task
  router.get('/api/tasks/:taskId/docs', async (req, res, next) => {
    try {
      const docs = await services.taskDocStore.getByTaskId(req.params.taskId);
      res.json(docs);
    } catch (err) { next(err); }
  });

  // Get a specific doc by task + type
  router.get('/api/tasks/:taskId/docs/:type', async (req, res, next) => {
    try {
      const doc = await services.taskDocStore.getByTaskIdAndType(
        req.params.taskId,
        req.params.type as DocArtifactType,
      );
      if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
      res.json(doc);
    } catch (err) { next(err); }
  });

  return router;
}
