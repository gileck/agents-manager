import { Router } from 'express';

export function healthRoutes(): Router {
  const router = Router();

  router.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  router.post('/api/shutdown', (_req, res) => {
    res.status(204).end();
    // Graceful shutdown after the response is sent
    setTimeout(() => process.exit(0), 100);
  });

  return router;
}
