import { Router } from 'express';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { isAbsolute, dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { getShellEnv } from '../../shared/shell-env';

const execFileAsync = promisify(execFileCb);

export function shellRoutes(): Router {
  const router = Router();

  // ── Open in Chrome ────────────────────────────────────────────────────
  router.post('/api/shell/open-in-chrome', async (req, res, next) => {
    try {
      const { url } = req.body as { url: string };
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        res.status(400).json({ error: `Invalid URL: ${url}` });
        return;
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        res.status(400).json({ error: `Unsupported protocol: ${parsed.protocol}` });
        return;
      }

      if (process.platform === 'darwin') {
        await execFileAsync('open', ['-a', 'Google Chrome', url]);
      } else {
        // Fallback: use xdg-open on Linux
        await execFileAsync('xdg-open', [url]);
      }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ── Open in iTerm ─────────────────────────────────────────────────────
  router.post('/api/shell/open-in-iterm', async (req, res, next) => {
    try {
      const { dirPath } = req.body as { dirPath: string };
      if (!dirPath || typeof dirPath !== 'string') {
        res.status(400).json({ error: 'Invalid directory path' });
        return;
      }
      if (!isAbsolute(dirPath)) {
        res.status(400).json({ error: 'Path must be absolute' });
        return;
      }
      if (!existsSync(dirPath)) {
        res.status(400).json({ error: `Directory does not exist: ${dirPath}` });
        return;
      }

      const env = getShellEnv();
      const script = `
        on run argv
          set dirPath to item 1 of argv
          tell application "iTerm"
            activate
            set newWindow to (create window with default profile)
            tell current session of newWindow
              write text "cd " & quoted form of dirPath
            end tell
          end tell
        end run
      `;
      await execFileAsync('osascript', ['-e', script, dirPath], { env });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ── Open in VS Code ───────────────────────────────────────────────────
  router.post('/api/shell/open-in-vscode', async (req, res, next) => {
    try {
      const { dirPath } = req.body as { dirPath: string };
      if (!dirPath || typeof dirPath !== 'string') {
        res.status(400).json({ error: 'Invalid directory path' });
        return;
      }
      if (!isAbsolute(dirPath)) {
        res.status(400).json({ error: 'Path must be absolute' });
        return;
      }
      if (!existsSync(dirPath)) {
        res.status(400).json({ error: `Directory does not exist: ${dirPath}` });
        return;
      }

      const env = getShellEnv();
      await execFileAsync('code', [dirPath], { env });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ── Open file in VS Code ─────────────────────────────────────────────
  router.post('/api/shell/open-file-in-vscode', async (req, res, next) => {
    try {
      const { filePath, line } = req.body as { filePath: string; line?: number };
      if (!filePath || typeof filePath !== 'string') {
        res.status(400).json({ error: 'Invalid file path' });
        return;
      }
      if (!isAbsolute(filePath)) {
        res.status(400).json({ error: 'Path must be absolute' });
        return;
      }
      if (line !== undefined && (typeof line !== 'number' || !Number.isFinite(line) || line < 1)) {
        res.status(400).json({ error: `Invalid line number: ${line}` });
        return;
      }
      if (!existsSync(filePath)) {
        res.status(400).json({ error: `File does not exist: ${filePath}` });
        return;
      }

      const env = getShellEnv();
      const target = line ? `${filePath}:${line}` : filePath;
      await execFileAsync('code', ['--goto', target], { env });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ── Pick folder (macOS osascript dialog) ──────────────────────────────
  router.get('/api/shell/pick-folder', async (_req, res, next) => {
    try {
      if (process.platform === 'darwin') {
        try {
          const { stdout } = await execFileAsync('osascript', [
            '-e', 'POSIX path of (choose folder)',
          ]);
          const folderPath = stdout.trim();
          res.json({ path: folderPath || null });
        } catch {
          // User cancelled the dialog
          res.json({ path: null });
        }
      } else {
        // No equivalent on other platforms — return null
        res.json({ path: null });
      }
    } catch (err) { next(err); }
  });

  // ── App version ───────────────────────────────────────────────────────
  router.get('/api/app/version', (_req, res, next) => {
    try {
      let dir = __dirname;
      while (dir !== dirname(dir)) {
        const candidate = join(dir, 'package.json');
        if (existsSync(candidate)) {
          const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
          res.json({ version: pkg.version || '0.0.0' });
          return;
        }
        dir = dirname(dir);
      }
      res.json({ version: '0.0.0' });
    } catch (err) { next(err); }
  });

  return router;
}
