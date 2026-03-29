import { Router } from 'express';
import type { TerminalManager } from '../terminal-manager';

export function terminalRoutes(terminalManager: TerminalManager): Router {
  const router = Router();

  // Create a new terminal session
  router.post('/api/terminals', async (req, res, next) => {
    try {
      const { projectId, name, cwd } = req.body as { projectId: string; name: string; cwd: string };
      if (!projectId || typeof projectId !== 'string') { res.status(400).json({ error: 'projectId is required' }); return; }
      if (!name || typeof name !== 'string') { res.status(400).json({ error: 'name is required' }); return; }
      if (!cwd || typeof cwd !== 'string') { res.status(400).json({ error: 'cwd is required' }); return; }
      const session = terminalManager.create(projectId, name, cwd);
      res.json(session);
    } catch (err) { next(err); }
  });

  // List all terminal sessions
  router.get('/api/terminals', async (_req, res, next) => {
    try {
      const sessions = terminalManager.list();
      res.json(sessions);
    } catch (err) { next(err); }
  });

  // Write data to a terminal
  router.post('/api/terminals/:id/write', async (req, res, next) => {
    try {
      const { data } = req.body as { data: string };
      if (typeof data !== 'string') { res.status(400).json({ error: 'data must be a string' }); return; }
      terminalManager.write(req.params.id, data);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Resize a terminal
  router.post('/api/terminals/:id/resize', async (req, res, next) => {
    try {
      const { cols, rows } = req.body as { cols: number; rows: number };
      if (!Number.isInteger(cols) || cols <= 0) { res.status(400).json({ error: 'cols must be a positive integer' }); return; }
      if (!Number.isInteger(rows) || rows <= 0) { res.status(400).json({ error: 'rows must be a positive integer' }); return; }
      terminalManager.resize(req.params.id, cols, rows);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Close a terminal
  router.delete('/api/terminals/:id', async (req, res, next) => {
    try {
      terminalManager.close(req.params.id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
}
