import { Router } from 'express';

export function healthRoutes(): Router {
  const router = Router();

  router.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  router.post('/api/shutdown', (_req, res) => {
    res.status(204).end();
    // Trigger the registered SIGTERM handler for graceful shutdown
    setImmediate(() => process.emit('SIGTERM'));
  });

  return router;
}
