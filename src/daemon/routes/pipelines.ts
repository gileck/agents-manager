import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';

export function pipelineRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/api/pipelines', async (_req, res, next) => {
    try {
      const pipelines = await services.pipelineStore.listPipelines();
      res.json(pipelines);
    } catch (err) { next(err); }
  });

  router.get('/api/pipelines/:id', async (req, res, next) => {
    try {
      const pipeline = await services.pipelineStore.getPipeline(req.params.id);
      if (!pipeline) { res.status(404).json({ error: 'Pipeline not found' }); return; }
      res.json(pipeline);
    } catch (err) { next(err); }
  });

  return router;
}
