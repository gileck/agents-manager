import express from 'express';
import { createServer as createHttpServer } from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { telegramRoutes } from '../../src/daemon/routes/telegram';

// Minimal stubs — POST /api/telegram/test does not use services or wsHolder
const fakeServices = {} as Parameters<typeof telegramRoutes>[0];
const fakeWsHolder = { server: null } as Parameters<typeof telegramRoutes>[1];

describe('POST /api/telegram/test', () => {
  let server: ReturnType<typeof createHttpServer>;
  let port: number;
  let realFetch: typeof globalThis.fetch;

  function stubTelegramFetch(mockResponse: { ok: boolean; status?: number; body: unknown }) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string | URL | Request, init?: RequestInit) => {
      // Intercept only Telegram API calls; pass local server calls through
      if (url.toString().startsWith('https://api.telegram.org')) {
        return Promise.resolve({
          ok: mockResponse.ok,
          status: mockResponse.status ?? (mockResponse.ok ? 200 : 400),
          json: async () => mockResponse.body,
        });
      }
      return realFetch(url, init);
    }));
  }

  beforeEach(async () => {
    vi.unstubAllGlobals();
    realFetch = globalThis.fetch.bind(globalThis);
    const app = express();
    app.use(express.json());
    app.use(telegramRoutes(fakeServices, fakeWsHolder));
    server = createHttpServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(() => {
    server?.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns { ok: true } when Telegram API succeeds', async () => {
    stubTelegramFetch({ ok: true, body: { ok: true, result: {} } });

    const res = await realFetch(`http://127.0.0.1:${port}/api/telegram/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: 'valid-token', chatId: '12345' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });
  });

  it('returns { ok: false, error } gracefully when Telegram API returns 400 (chat not found)', async () => {
    stubTelegramFetch({
      ok: false,
      status: 400,
      body: { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
    });

    const res = await realFetch(`http://127.0.0.1:${port}/api/telegram/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: 'valid-token', chatId: 'bad-chat' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: false, error: 'Bad Request: chat not found' });
  });

  it('returns { ok: false, error } gracefully when Telegram API returns 401 (Unauthorized)', async () => {
    stubTelegramFetch({
      ok: false,
      status: 401,
      body: { ok: false, error_code: 401, description: 'Unauthorized' },
    });

    const res = await realFetch(`http://127.0.0.1:${port}/api/telegram/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: 'bad-token', chatId: '12345' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: false, error: 'Unauthorized' });
  });

  it('returns HTTP 400 when botToken or chatId are missing', async () => {
    const res = await realFetch(`http://127.0.0.1:${port}/api/telegram/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: 'only-token' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('botToken and chatId are required');
  });
});
