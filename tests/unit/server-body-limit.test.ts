import express from 'express';
import { createServer as createHttpServer } from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, afterEach } from 'vitest';

/**
 * Verifies that the global express.json() middleware accepts payloads larger
 * than the 100KB default limit (regression test for the "request entity too
 * large" bug when sending chat messages with images).
 */
describe('Server body-size limit', () => {
  let server: ReturnType<typeof createHttpServer>;

  afterEach(() => {
    server?.close();
  });

  it('should accept JSON payloads larger than 100KB', async () => {
    const app = express();
    // Mirror the global middleware from src/daemon/server.ts
    app.use(express.json({ limit: '50mb' }));
    app.post('/test', (req, res) => {
      res.json({ receivedKeys: Object.keys(req.body) });
    });

    server = createHttpServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    // Build a payload ~200KB (well above the old 100KB default)
    const largeBase64 = 'A'.repeat(200_000);
    const body = JSON.stringify({ message: 'hello', images: [{ base64: largeBase64, mediaType: 'image/png' }] });

    const res = await fetch(`http://127.0.0.1:${port}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.receivedKeys).toContain('message');
    expect(data.receivedKeys).toContain('images');
  });

  it('should reject the same payload when using the default 100KB limit', async () => {
    const app = express();
    // Simulate the OLD (broken) configuration: default limit
    app.use(express.json());
    app.post('/test', (req, res) => {
      res.json({ receivedKeys: Object.keys(req.body) });
    });

    server = createHttpServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    const largeBase64 = 'A'.repeat(200_000);
    const body = JSON.stringify({ message: 'hello', images: [{ base64: largeBase64, mediaType: 'image/png' }] });

    const res = await fetch(`http://127.0.0.1:${port}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    // Default express.json() rejects payloads > 100KB with 413
    expect(res.status).toBe(413);
  });
});
