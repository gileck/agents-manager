import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';

export function artifactRoutes(services: AppServices): Router {
  const router = Router();

  // GET /api/tasks/:taskId/artifacts — list artifacts for task
  router.get('/api/tasks/:taskId/artifacts', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const artifacts = await services.taskArtifactStore.getArtifactsForTask(taskId);
      res.json(artifacts);
    } catch (err) { next(err); }
  });

  return router;
}
