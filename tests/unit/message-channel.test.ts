import { describe, it, expect } from 'vitest';
import { createMessageChannel } from '../../src/core/utils/message-channel';

describe('MessageChannel', () => {
  it('should yield pushed messages in FIFO order', async () => {
    const ch = createMessageChannel<string>();
    ch.push('a');
    ch.push('b');
    ch.close();

    const results: string[] = [];
    for await (const msg of ch) {
      results.push(msg);
    }
    expect(results).toEqual(['a', 'b']);
  });

  it('should return false from push() after close()', () => {
    const ch = createMessageChannel<string>();
    expect(ch.push('a')).toBe(true);
    ch.close();
    expect(ch.push('b')).toBe(false);
    expect(ch.isClosed).toBe(true);
  });

  it('should terminate the async iterator when close() is called while waiting', async () => {
    const ch = createMessageChannel<string>();
    ch.push('first');

    // Start consuming — will yield 'first' then block waiting for more
    const results: string[] = [];
    const consuming = (async () => {
      for await (const msg of ch) {
        results.push(msg);
      }
    })();

    // Give the consumer time to process 'first' and enter the wait state
    await new Promise(r => setTimeout(r, 10));

    // Close should unblock the waiting consumer
    ch.close();
    await consuming;

    expect(results).toEqual(['first']);
  });

  it('should drain remaining queued messages after close()', async () => {
    const ch = createMessageChannel<number>();
    ch.push(1);
    ch.push(2);

    // Start consuming
    const results: number[] = [];
    const consuming = (async () => {
      for await (const msg of ch) {
        results.push(msg);
        // After receiving first message, push another and close
        if (msg === 2) {
          ch.push(3);
          ch.close();
        }
      }
    })();

    await consuming;
    // Message 3 was pushed before close, so it should be drained
    expect(results).toEqual([1, 2, 3]);
  });

  it('should be idempotent when close() is called multiple times', () => {
    const ch = createMessageChannel<string>();
    ch.close();
    ch.close(); // should not throw
    expect(ch.isClosed).toBe(true);
  });
});
