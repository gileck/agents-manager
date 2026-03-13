import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { AppServices } from '../../core/providers/setup';
import type { ChatImage } from '../../shared/types';

const MEDIA_TYPE_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function getScreenshotStorageDir(services: AppServices): string {
  const imageDir = services.chatAgentService.getImageStorageDir();
  return path.join(path.dirname(imageDir), 'screenshots');
}

export function screenshotRoutes(services: AppServices): Router {
  const router = Router();

  // Save screenshots to disk
  router.post('/api/screenshots', async (req, res, next) => {
    try {
      const { images } = req.body as { images: ChatImage[] };
      if (!images || !Array.isArray(images) || images.length === 0) {
        res.status(400).json({ error: 'images array is required' });
        return;
      }
      if (images.length > 5) {
        res.status(400).json({ error: 'Maximum 5 images allowed' });
        return;
      }

      // Decode and validate all images before writing any to disk
      const decoded: { buffer: Buffer; ext: string }[] = [];
      for (const img of images) {
        const ext = MEDIA_TYPE_TO_EXT[img.mediaType] || 'png';
        const buffer = Buffer.from(img.base64, 'base64');
        if (buffer.length === 0) {
          res.status(400).json({ error: `Image "${img.name || 'unnamed'}" decoded to empty data` });
          return;
        }
        decoded.push({ buffer, ext });
      }

      const storageDir = getScreenshotStorageDir(services);
      await fs.promises.mkdir(storageDir, { recursive: true });

      const paths: string[] = [];
      for (const { buffer, ext } of decoded) {
        const filename = `${randomUUID()}.${ext}`;
        const filePath = path.join(storageDir, filename);
        await fs.promises.writeFile(filePath, buffer);
        paths.push(`/api/screenshots?path=${encodeURIComponent(filePath)}`);
      }

      res.json({ paths });
    } catch (err) { next(err); }
  });

  // Serve screenshot files
  router.get('/api/screenshots', (req, res, next) => {
    try {
      const rawPath = req.query.path as string | undefined;
      if (!rawPath) {
        res.status(400).json({ error: 'path query param is required' });
        return;
      }
      const storageDir = getScreenshotStorageDir(services);
      const resolved = path.resolve(rawPath);
      const storageRoot = path.resolve(storageDir);
      if (!resolved.startsWith(storageRoot + path.sep) && resolved !== storageRoot) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (!fs.existsSync(resolved)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      res.sendFile(resolved);
    } catch (err) { next(err); }
  });

  return router;
}
