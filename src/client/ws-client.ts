/**
 * WebSocket subscription client for the agents-manager daemon.
 *
 * Subscribes to channels on the daemon WS server (`ws://host/ws`) and
 * dispatches incoming messages to registered callbacks. Supports
 * auto-reconnect with exponential backoff.
 */

import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback for channel+id scoped subscriptions. */
type ScopedCallback = (data: unknown) => void;

/** Callback for global (all-ids) channel subscriptions. */
type GlobalCallback = (id: string | undefined, data: unknown) => void;

interface IncomingMessage {
  channel: string;
  id?: string;
  data: unknown;
}

export interface WsClient {
  /**
   * Subscribe to a specific channel, optionally scoped to an id.
   * Returns an unsubscribe function.
   */
  subscribe(channel: string, id?: string, callback?: ScopedCallback): () => void;

  /**
   * Subscribe to ALL messages on a channel regardless of id.
   * The callback receives both the id and the data.
   * Returns an unsubscribe function.
   */
  subscribeGlobal(channel: string, callback: GlobalCallback): () => void;

  /** Close the WebSocket connection and stop reconnecting. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function createWsClient(
  url: string,
  opts?: { reconnect?: boolean },
): WsClient {
  const shouldReconnect = opts?.reconnect ?? true;

  // Scoped subscriptions: key = "channel" or "channel:id"
  const scopedListeners = new Map<string, Set<ScopedCallback>>();

  // Global subscriptions: key = channel
  const globalListeners = new Map<string, Set<GlobalCallback>>();

  // Track active subscriptions for re-subscribe after reconnect
  const activeSubscriptions = new Set<string>(); // serialized subscribe messages

  let ws: WebSocket | null = null;
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  // ------- helpers -------

  function subKey(channel: string, id?: string): string {
    return id ? `${channel}:${id}` : channel;
  }

  function sendSub(type: 'subscribe' | 'unsubscribe', channel: string, id?: string): void {
    const msg = JSON.stringify({ type, channel, id });
    if (type === 'subscribe') {
      activeSubscriptions.add(msg);
    } else {
      // Remove the matching subscribe message
      const subMsg = JSON.stringify({ type: 'subscribe', channel, id });
      activeSubscriptions.delete(subMsg);
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }

  function dispatch(incoming: IncomingMessage): void {
    const { channel, id, data } = incoming;

    // Dispatch to scoped listeners (exact channel+id or channel-only)
    const exactKey = subKey(channel, id);
    const channelKey = channel;

    for (const key of [exactKey, channelKey]) {
      const cbs = scopedListeners.get(key);
      if (cbs) {
        for (const cb of cbs) {
          try { cb(data); } catch { /* consumer error */ }
        }
      }
    }

    // Dispatch to global listeners
    const globalCbs = globalListeners.get(channel);
    if (globalCbs) {
      for (const cb of globalCbs) {
        try { cb(id, data); } catch { /* consumer error */ }
      }
    }
  }

  function connect(): void {
    if (closed) return;

    ws = new WebSocket(url);

    ws.on('open', () => {
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      // Re-subscribe to all active subscriptions
      for (const msg of activeSubscriptions) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(msg);
        }
      }
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as IncomingMessage;
        if (msg.channel) dispatch(msg);
      } catch {
        /* ignore malformed */
      }
    });

    ws.on('close', () => {
      ws = null;
      if (!closed && shouldReconnect) {
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
          connect();
        }, reconnectDelay);
      }
    });

    ws.on('error', () => {
      // The 'close' event will fire after this, triggering reconnect
    });
  }

  // Start the initial connection
  connect();

  // ------- public API -------

  return {
    subscribe(channel: string, id?: string, callback?: ScopedCallback): () => void {
      const key = subKey(channel, id);
      sendSub('subscribe', channel, id);

      if (callback) {
        if (!scopedListeners.has(key)) scopedListeners.set(key, new Set());
        scopedListeners.get(key)!.add(callback);
      }

      return () => {
        if (callback) {
          const cbs = scopedListeners.get(key);
          if (cbs) {
            cbs.delete(callback);
            if (cbs.size === 0) scopedListeners.delete(key);
          }
        }
        // Only send unsubscribe if no more listeners for this key
        const remainingScoped = scopedListeners.get(key)?.size ?? 0;
        if (remainingScoped === 0) {
          sendSub('unsubscribe', channel, id);
        }
      };
    },

    subscribeGlobal(channel: string, callback: GlobalCallback): () => void {
      // Subscribe with wildcard id
      const wildcardMsg = JSON.stringify({ type: 'subscribe', channel, id: '*' });
      activeSubscriptions.add(wildcardMsg);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(wildcardMsg);
      }

      if (!globalListeners.has(channel)) globalListeners.set(channel, new Set());
      globalListeners.get(channel)!.add(callback);

      return () => {
        const cbs = globalListeners.get(channel);
        if (cbs) {
          cbs.delete(callback);
          if (cbs.size === 0) {
            globalListeners.delete(channel);
            activeSubscriptions.delete(wildcardMsg);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'unsubscribe', channel, id: '*' }));
            }
          }
        }
      };
    },

    close(): void {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      scopedListeners.clear();
      globalListeners.clear();
      activeSubscriptions.clear();
    },
  };
}
