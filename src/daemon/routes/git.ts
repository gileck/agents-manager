import { Router } from 'express';
import { LocalGitOps } from '../../core/services/local-git-ops';
import type { AppServices } from '../../core/providers/setup';

/**
 * Resolve a LocalGitOps instance scoped to the task's worktree.
 * Returns null if the task or project is missing, or no worktree exists.
 */
async function getTaskGitOps(services: AppServices, taskId: string): Promise<LocalGitOps | null> {
  const task = await services.taskStore.getTask(taskId);
  if (!task) return null;
  const project = await services.projectStore.getProject(task.projectId);
  if (!project?.path) return null;
  const wm = services.createWorktreeManager(project.path);
  const worktree = await wm.get(taskId);
  if (!worktree) return null;
  return new LocalGitOps(worktree.path);
}

export function gitRoutes(services: AppServices): Router {
  const router = Router();

  // GET /api/tasks/:taskId/git/diff — get diff against origin/main
  router.get('/api/tasks/:taskId/git/diff', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const gitOps = await getTaskGitOps(services, taskId);
      if (!gitOps) {
        res.json(null);
        return;
      }
      try {
        const diff = await gitOps.diff('origin/main');
        res.json({ diff });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        services.taskEventLog.log({ taskId, category: 'git', severity: 'warning', message: `GIT_DIFF failed: ${msg}` }).catch(() => {});
        res.json(null);
      }
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/git/log — get git log
  router.get('/api/tasks/:taskId/git/log', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const gitOps = await getTaskGitOps(services, taskId);
      if (!gitOps) {
        res.json(null);
        return;
      }
      try {
        const log = await gitOps.log();
        res.json(log);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        services.taskEventLog.log({ taskId, category: 'git', severity: 'warning', message: `GIT_LOG failed: ${msg}` }).catch(() => {});
        res.json(null);
      }
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/git/status — get git status
  router.get('/api/tasks/:taskId/git/status', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const gitOps = await getTaskGitOps(services, taskId);
      if (!gitOps) {
        res.json(null);
        return;
      }
      try {
        const status = await gitOps.status();
        res.json({ status });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        services.taskEventLog.log({ taskId, category: 'git', severity: 'warning', message: `GIT_STATUS failed: ${msg}` }).catch(() => {});
        res.json(null);
      }
    } catch (err) { next(err); }
  });

  return router;
}
