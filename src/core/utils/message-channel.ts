/**
 * AsyncIterable message channel for streaming input to the Claude Agent SDK.
 *
 * Creates a FIFO queue backed by promises that implements `AsyncIterable<T>`.
 * External callers push messages via `push()`, and the SDK pulls them via
 * `for await...of`. The channel stays open until explicitly closed via `close()`.
 *
 * Thread safety: `push()` and `close()` are synchronous — safe to call from
 * concurrent async contexts without a mutex. The queue array is mutated only
 * via synchronous operations (push/shift).
 */

/** Sentinel value used internally to signal the channel is closing. */
const CLOSED_SENTINEL = Symbol('CHANNEL_CLOSED');

export interface MessageChannel<T> {
  /** Push a message into the channel. Returns false if the channel is already closed. */
  push(msg: T): boolean;
  /** Close the channel. The async iterator will drain remaining queued messages and then terminate. */
  close(): void;
  /** Whether the channel has been closed. */
  readonly isClosed: boolean;
  /** AsyncIterable protocol — use with `for await...of` or pass directly to the SDK's `prompt` parameter. */
  [Symbol.asyncIterator](): AsyncGenerator<T>;
}

export function createMessageChannel<T>(): MessageChannel<T> {
  const queue: T[] = [];
  let waiting: ((value: T | typeof CLOSED_SENTINEL) => void) | null = null;
  let closed = false;

  return {
    push(msg: T): boolean {
      if (closed) return false;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(msg);
      } else {
        queue.push(msg);
      }
      return true;
    },

    close() {
      if (closed) return;
      closed = true;
      // If the generator is waiting for a message, wake it up with the sentinel
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(CLOSED_SENTINEL);
      }
    },

    get isClosed() {
      return closed;
    },

    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      try {
        while (true) {
          // Drain any queued messages first
          while (queue.length > 0) {
            yield queue.shift()!;
          }

          // If closed after draining, exit
          if (closed) return;

          // Wait for the next message or close signal
          const value = await new Promise<T | typeof CLOSED_SENTINEL>((resolve) => {
            waiting = resolve;
          });

          if (value === CLOSED_SENTINEL) {
            // Drain any messages that were pushed between the close() call and here
            while (queue.length > 0) {
              yield queue.shift()!;
            }
            return;
          }

          yield value as T;
        }
      } finally {
        // Ensure cleanup: mark closed if not already, clear any dangling state
        closed = true;
        waiting = null;
      }
    },
  };
}
