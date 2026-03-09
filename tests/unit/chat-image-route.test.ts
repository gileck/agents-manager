import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import { createServer as createHttpServer } from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';

/**
 * Unit tests for the GET /api/chat/images route.
 * The route is tested directly by wiring up a minimal express app
 * that mirrors the route handler logic from src/daemon/routes/chat.ts.
 */
describe('GET /api/chat/images', () => {
  let server: ReturnType<typeof createHttpServer>;
  let imageStorageDir: string;
  let testImagePath: string;

  beforeEach(async () => {
    // Create a temp dir that acts as the image storage directory
    imageStorageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'chat-images-test-'));
    // Write a small PNG-like file for serving
    testImagePath = path.join(imageStorageDir, 'test-session', 'image.png');
    await fs.promises.mkdir(path.dirname(testImagePath), { recursive: true });
    await fs.promises.writeFile(testImagePath, Buffer.from('PNG_DATA'));

    // Build a minimal express app with only the image-serving route
    const app = express();
    const storageDir = imageStorageDir;

    app.get('/api/chat/images', (req, res, next) => {
      try {
        const rawPath = req.query.path;
        if (typeof rawPath !== 'string' || !rawPath) {
          res.status(400).json({ error: 'path query param is required' });
          return;
        }
        const resolved = path.resolve(rawPath);
        const storageRoot = path.resolve(storageDir);
        if (!resolved.startsWith(storageRoot + path.sep) && resolved !== storageRoot) {
          res.status(403).json({ error: 'Access denied' });
          return;
        }
        res.sendFile(resolved, (err) => {
          if (err) next(err);
        });
      } catch (err) { next(err); }
    });

    server = createHttpServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    server?.close();
    await fs.promises.rm(imageStorageDir, { recursive: true, force: true });
  });

  function getPort(): number {
    return (server.address() as AddressInfo).port;
  }

  it('returns 200 and the file for a valid path within the storage dir', async () => {
    const port = getPort();
    const res = await fetch(
      `http://127.0.0.1:${port}/api/chat/images?path=${encodeURIComponent(testImagePath)}`
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('PNG_DATA');
  });

  it('returns 403 for a path outside the storage directory', async () => {
    const port = getPort();
    const outsidePath = path.join(os.tmpdir(), 'sensitive-file.txt');
    const res = await fetch(
      `http://127.0.0.1:${port}/api/chat/images?path=${encodeURIComponent(outsidePath)}`
    );
    expect(res.status).toBe(403);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Access denied');
  });

  it('returns 403 for a path traversal attempt', async () => {
    const port = getPort();
    const traversalPath = path.join(imageStorageDir, '..', 'etc', 'passwd');
    const res = await fetch(
      `http://127.0.0.1:${port}/api/chat/images?path=${encodeURIComponent(traversalPath)}`
    );
    expect(res.status).toBe(403);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Access denied');
  });

  it('returns 400 when the path query param is missing', async () => {
    const port = getPort();
    const res = await fetch(`http://127.0.0.1:${port}/api/chat/images`);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('path query param is required');
  });
});
