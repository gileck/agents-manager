import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { CodexAppServerClient } from '../../src/core/libs/codex-app-server-client';

class FakeChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((_signal?: NodeJS.Signals | number) => {
    this.emit('close', 0, null);
    return true;
  });
}

describe('CodexAppServerClient', () => {
  it('initializes, sends requests, and dispatches notifications', async () => {
    const child = new FakeChildProcess();
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    const serverRequestResponses: Array<Record<string, unknown>> = [];

    child.stdin.on('data', (chunk: Buffer | string) => {
      const lines = chunk.toString('utf8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const message = JSON.parse(line) as { method?: string; id: string; params?: Record<string, unknown>; result?: unknown };
        if (message.method === 'initialize') {
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'Codex Test' } })}\n`);
        } else if (message.method === 'thread/start') {
          child.stdout.write(`${JSON.stringify({ method: 'thread/started', params: { thread: { id: 'thread-1', cwd: '/tmp/project' } } })}\n`);
          child.stdout.write(`${JSON.stringify({ method: 'item/commandExecution/requestApproval', id: 'server-1', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'cmd-1', command: 'ls', cwd: '/tmp/project' } })}\n`);
          child.stdout.write(`${JSON.stringify({ id: message.id, result: { thread: { id: 'thread-1', cwd: '/tmp/project' } } })}\n`);
        } else if (message.result != null || !message.method) {
          serverRequestResponses.push(message as Record<string, unknown>);
        }
      }
    });

    const client = new CodexAppServerClient({
      spawnProcess: vi.fn(() => child as never),
      onNotification: (notification) => notifications.push(notification),
      onServerRequest: async (request) => {
        expect(request.method).toBe('item/commandExecution/requestApproval');
        return 'accept';
      },
      clientInfo: { name: 'agents-manager', version: 'test' },
    });

    await client.start();
    const response = await client.threadStart({
      model: 'gpt-5.4',
      cwd: '/tmp/project',
      approvalPolicy: 'never',
      sandbox: 'read-only',
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    });

    expect(response.thread.id).toBe('thread-1');
    expect(notifications).toEqual([
      {
        method: 'thread/started',
        params: { thread: { id: 'thread-1', cwd: '/tmp/project' } },
      },
    ]);
    expect(serverRequestResponses).toContainEqual({ id: 'server-1', result: 'accept' });

    await client.close();
    expect(child.kill).toHaveBeenCalled();
  });
});
