import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';

export function devServerRoutes(services: AppServices): Router {
  const router = Router();

  // POST /api/tasks/:taskId/dev-server/start — start dev server in task worktree
  router.post('/api/tasks/:taskId/dev-server/start', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const task = await services.taskStore.getTask(taskId);
      if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

      const project = await services.projectStore.getProject(task.projectId);
      if (!project?.path) { res.status(400).json({ error: 'Project has no path configured' }); return; }

      const command = (project.config?.devServerCommand as string | undefined)?.trim();
      if (!command) { res.status(400).json({ error: 'Project has no devServerCommand configured' }); return; }

      const wm = services.createWorktreeManager(project.path);
      const worktree = await wm.get(taskId);
      if (!worktree) { res.status(404).json({ error: 'No worktree found for this task' }); return; }

      // Ensure node_modules symlink is intact before starting
      await wm.ensureNodeModules(taskId);

      const info = await services.devServerManager.start(taskId, project.id, worktree.path, command);
      res.json(info);
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/dev-server/stop — stop dev server
  router.post('/api/tasks/:taskId/dev-server/stop', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      await services.devServerManager.stop(taskId);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/dev-server/status — get dev server status
  router.get('/api/tasks/:taskId/dev-server/status', (req, res) => {
    const { taskId } = req.params;
    const info = services.devServerManager.getStatus(taskId);
    res.json(info);
  });

  // GET /api/dev-servers — list all running dev servers
  router.get('/api/dev-servers', (_req, res) => {
    res.json(services.devServerManager.list());
  });

  return router;
}
