import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import type { AppServices } from '../../core/providers/setup';

/** MIME types for allowed file extensions */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

/** Only these extensions may be served */
const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_TYPES));

/** Extensions that should be read as utf-8 text (vs raw buffer for binary) */
const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.svg']);

export function worktreeFileRoutes(services: AppServices): Router {
  const router = Router();

  /**
   * GET /api/worktree/:taskId/file?path=<relative-path>
   *
   * Serves a file from a task's worktree with the appropriate Content-Type.
   * Used by the UI to render HTML mock files in sandboxed iframes.
   */
  router.get('/api/worktree/:taskId/file', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const filePath = req.query.path as string | undefined;

      if (!filePath) {
        res.status(400).json({ error: 'path query parameter is required' });
        return;
      }

      // Validate file extension
      const ext = path.extname(filePath).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        res.status(403).json({ error: `File type '${ext}' is not allowed` });
        return;
      }

      // Resolve task -> project -> worktree (same pattern as tasks.ts:308-318)
      const task = await services.taskStore.getTask(taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const project = await services.projectStore.getProject(task.projectId);
      if (!project?.path) {
        res.status(404).json({ error: 'Project not found or has no path' });
        return;
      }

      const wm = services.createWorktreeManager(project.path);
      const worktree = await wm.get(taskId);
      if (!worktree) {
        res.status(404).json({ error: 'Worktree not found for task' });
        return;
      }

      // Path traversal protection: resolve and verify the path stays within the worktree
      const worktreePath = path.resolve(worktree.path);
      const resolvedFile = path.resolve(worktreePath, filePath);
      if (!resolvedFile.startsWith(worktreePath + path.sep) && resolvedFile !== worktreePath) {
        res.status(403).json({ error: 'Path traversal is not allowed' });
        return;
      }

      // Read the file
      const isText = TEXT_EXTENSIONS.has(ext);
      const content = await fs.readFile(resolvedFile, isText ? 'utf-8' : undefined).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      });

      if (content === null) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      res.setHeader('Content-Type', MIME_TYPES[ext]);
      res.send(content);
    } catch (err) { next(err); }
  });

  return router;
}
