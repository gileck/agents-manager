import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { FeatureCreateInput, FeatureUpdateInput, FeatureFilter } from '../../shared/types';

export function featureRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/api/features', async (req, res, next) => {
    try {
      const filter: FeatureFilter = {};
      if (req.query.projectId) filter.projectId = req.query.projectId as string;
      const features = await services.featureStore.listFeatures(filter);
      res.json(features);
    } catch (err) { next(err); }
  });

  router.get('/api/features/:id', async (req, res, next) => {
    try {
      const feature = await services.featureStore.getFeature(req.params.id);
      if (!feature) { res.status(404).json({ error: 'Feature not found' }); return; }
      res.json(feature);
    } catch (err) { next(err); }
  });

  router.post('/api/features', async (req, res, next) => {
    try {
      const input = req.body as FeatureCreateInput;
      if (!input.projectId || !input.title) {
        res.status(400).json({ error: 'projectId and title are required' });
        return;
      }
      const feature = await services.featureStore.createFeature(input);
      res.status(201).json(feature);
    } catch (err) { next(err); }
  });

  router.put('/api/features/:id', async (req, res, next) => {
    try {
      const input = req.body as FeatureUpdateInput;
      const feature = await services.featureStore.updateFeature(req.params.id, input);
      if (!feature) { res.status(404).json({ error: 'Feature not found' }); return; }
      res.json(feature);
    } catch (err) { next(err); }
  });

  router.delete('/api/features/:id', async (req, res, next) => {
    try {
      const deleted = await services.featureStore.deleteFeature(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Feature not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
