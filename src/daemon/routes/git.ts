import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { IGitOps } from '../../core/interfaces/git-ops';
import { getAppLogger } from '../../core/services/app-logger';

/**
 * Resolve a IGitOps instance scoped to the task's worktree.
 * Returns null if the task or project is missing, or no worktree exists.
 */
async function getTaskGitOps(services: AppServices, taskId: string): Promise<IGitOps | null> {
  const task = await services.taskStore.getTask(taskId);
  if (!task) return null;
  const project = await services.projectStore.getProject(task.projectId);
  if (!project?.path) return null;
  const wm = services.createWorktreeManager(project.path);
  const worktree = await wm.get(taskId);
  if (!worktree) return null;
  return services.createGitOps(worktree.path);
}

async function withProjectGit<T>(services: AppServices, projectId: string, fallback: T, fn: (git: IGitOps) => Promise<T>): Promise<T> {
  const project = await services.projectStore.getProject(projectId);
  if (!project?.path) return fallback;
  return fn(services.createGitOps(project.path));
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

  // GET /api/tasks/:taskId/git/stat — get diff stat against origin/main
  router.get('/api/tasks/:taskId/git/stat', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const gitOps = await getTaskGitOps(services, taskId);
      if (!gitOps) {
        res.json(null);
        return;
      }
      try {
        const stat = await gitOps.diffStat('origin/main');
        res.json(stat);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        services.taskEventLog.log({ taskId, category: 'git', severity: 'warning', message: `GIT_STAT failed: ${msg}` }).catch(() => {});
        res.json(null);
      }
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/git/working-diff — get diff against HEAD (working changes)
  router.get('/api/tasks/:taskId/git/working-diff', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const gitOps = await getTaskGitOps(services, taskId);
      if (!gitOps) {
        res.json(null);
        return;
      }
      try {
        const diff = await gitOps.diff('HEAD');
        res.json({ diff });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        services.taskEventLog.log({ taskId, category: 'git', severity: 'warning', message: `GIT_WORKING_DIFF failed: ${msg}` }).catch(() => {});
        res.json(null);
      }
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/git/reset-file — reset a single file
  router.post('/api/tasks/:taskId/git/reset-file', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { filepath } = req.body as { filepath?: string };
      if (!filepath || typeof filepath !== 'string') {
        res.status(400).json({ error: 'filepath is required' });
        return;
      }
      const gitOps = await getTaskGitOps(services, taskId);
      if (!gitOps) {
        res.status(404).json({ error: 'No worktree for task' });
        return;
      }
      await gitOps.resetFile(filepath);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/git/clean — clean untracked files
  router.post('/api/tasks/:taskId/git/clean', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const gitOps = await getTaskGitOps(services, taskId);
      if (!gitOps) {
        res.status(404).json({ error: 'No worktree for task' });
        return;
      }
      await gitOps.clean();
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/git/pull — pull current branch
  router.post('/api/tasks/:taskId/git/pull', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const gitOps = await getTaskGitOps(services, taskId);
      if (!gitOps) {
        res.status(404).json({ error: 'No worktree for task' });
        return;
      }
      const { branch } = req.body as { branch?: string };
      const targetBranch = branch ?? await gitOps.getCurrentBranch();
      await gitOps.pull(targetBranch);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/git/show/:hash — show commit detail
  router.get('/api/tasks/:taskId/git/show/:hash', async (req, res, next) => {
    try {
      const { taskId, hash } = req.params;
      const gitOps = await getTaskGitOps(services, taskId);
      if (!gitOps) {
        res.json(null);
        return;
      }
      try {
        const commit = await gitOps.showCommit(hash);
        res.json(commit);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        services.taskEventLog.log({ taskId, category: 'git', severity: 'warning', message: `GIT_SHOW failed: ${msg}` }).catch(() => {});
        res.json(null);
      }
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/pr/checks — get PR check runs and merge status
  router.get('/api/tasks/:taskId/pr/checks', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const task = await services.taskStore.getTask(taskId);
      if (!task?.prLink) {
        res.json(null);
        return;
      }
      const project = await services.projectStore.getProject(task.projectId);
      if (!project?.path) {
        res.json(null);
        return;
      }
      try {
        const scm = services.createScmPlatform(project.path);
        const result = await scm.getPRChecks(task.prLink);
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        services.taskEventLog.log({ taskId, category: 'github', severity: 'warning', message: `PR_CHECKS failed: ${msg}` }).catch(logErr => {
          getAppLogger().logError('git-routes', `Failed to log PR_CHECKS error for task ${taskId}`, logErr);
        });
        res.json(null);
      }
    } catch (err) { next(err); }
  });

  // ============================================
  // Source Control Operations (project-scoped)
  // ============================================

  // GET /api/projects/:projectId/git/log — git log for project
  router.get('/api/projects/:projectId/git/log', async (req, res, next) => {
    try {
      const { projectId } = req.params;
      const count = req.query.count ? Number(req.query.count) : 50;
      const log = await withProjectGit(services, projectId, [], (git) => git.log(count));
      res.json(log);
    } catch (err) { next(err); }
  });

  // GET /api/projects/:projectId/git/branch — current branch for project
  router.get('/api/projects/:projectId/git/branch', async (req, res, next) => {
    try {
      const { projectId } = req.params;
      const branch = await withProjectGit(services, projectId, '', (git) => git.getCurrentBranch());
      res.json({ branch });
    } catch (err) { next(err); }
  });

  // GET /api/projects/:projectId/git/commit/:hash — commit detail for project
  router.get('/api/projects/:projectId/git/commit/:hash', async (req, res, next) => {
    try {
      const { projectId, hash } = req.params;
      if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
        res.status(400).json({ error: 'Invalid commit hash' });
        return;
      }
      const detail = await withProjectGit(
        services, projectId,
        { hash, body: '', files: [] },
        (git) => git.getCommitDetail(hash),
      );
      res.json(detail);
    } catch (err) { next(err); }
  });

  // POST /api/projects/:projectId/git/sync-main — pull origin main and push
  router.post('/api/projects/:projectId/git/sync-main', async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await services.projectStore.getProject(projectId);
      if (!project?.path) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      const gitOps = services.createGitOps(project.path);
      await gitOps.pull('main');
      await gitOps.push('main');
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hasConflicts = /conflict/i.test(message) || /CONFLICT/i.test(message);
      res.status(hasConflicts ? 409 : 500).json({ error: message, hasConflicts });
    }
  });

  return router;
}
