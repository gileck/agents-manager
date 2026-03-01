import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';

export function dashboardRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/api/dashboard/stats', async (_req, res, next) => {
    try {
      const stats = await services.workflowService.getDashboardStats();
      res.json(stats);
    } catch (err) { next(err); }
  });

  return router;
}
