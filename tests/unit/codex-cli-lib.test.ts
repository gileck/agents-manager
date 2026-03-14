import { describe, expect, it, vi } from 'vitest';
import { CodexCliLib } from '../../src/core/libs/codex-cli-lib';

describe('CodexCliLib', () => {
  it('passes danger-full-access sandbox mode to the Codex SDK', async () => {
    const startThread = vi.fn();

    class FakeCodex {
      startThread = startThread.mockImplementation((_options) => ({
        id: 'thread-1',
        runStreamed: async () => ({
          events: (async function* () {
            yield { type: 'thread.started', thread_id: 'thread-1' };
            yield {
              type: 'turn.completed',
              usage: {
                input_tokens: 0,
                cached_input_tokens: 0,
                output_tokens: 0,
              },
            };
          })(),
        }),
      }));

      resumeThread = vi.fn();
    }

    const lib = new CodexCliLib();
    (lib as unknown as { tryLoadCodexConstructor: () => Promise<typeof FakeCodex> }).tryLoadCodexConstructor = vi.fn(async () => FakeCodex);

    const result = await lib.execute('run-1', {
      prompt: 'hello',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: [],
      readOnlyPaths: [],
      readOnly: false,
      permissionMode: 'full_access',
    }, {});

    expect(result.exitCode).toBe(0);
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      sandboxMode: 'danger-full-access',
    }));
  });
});
