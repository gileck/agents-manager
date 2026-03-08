/**
 * Browser-native WebSocket client for the agents-manager daemon.
 *
 * Mirrors the WsClient interface from src/client/ws-client.ts but uses
 * the browser's built-in WebSocket API instead of the Node `ws` package.
 */

// ---------------------------------------------------------------------------
// Types (same as ws-client.ts)
// ---------------------------------------------------------------------------

type ScopedCallback = (data: unknown) => void;
type GlobalCallback = (id: string | undefined, data: unknown) => void;

interface IncomingMessage {
  channel: string;
  id?: string;
  data: unknown;
}

export interface BrowserWsClient {
  subscribe(channel: string, id?: string, callback?: ScopedCallback): () => void;
  subscribeGlobal(channel: string, callback: GlobalCallback): () => void;
  close(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function createBrowserWsClient(
  url: string,
  opts?: { reconnect?: boolean },
): BrowserWsClient {
  const shouldReconnect = opts?.reconnect ?? true;

  const scopedListeners = new Map<string, Set<ScopedCallback>>();
  const globalListeners = new Map<string, Set<GlobalCallback>>();
  const activeSubscriptions = new Set<string>();

  let ws: WebSocket | null = null;
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function subKey(channel: string, id?: string): string {
    return id ? `${channel}:${id}` : channel;
  }

  function sendSub(type: 'subscribe' | 'unsubscribe', channel: string, id?: string): void {
    const msg = JSON.stringify({ type, channel, id });
    if (type === 'subscribe') {
      activeSubscriptions.add(msg);
    } else {
      const subMsg = JSON.stringify({ type: 'subscribe', channel, id });
      activeSubscriptions.delete(subMsg);
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }

  function dispatch(incoming: IncomingMessage): void {
    const { channel, id, data } = incoming;
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

    ws.addEventListener('open', () => {
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      for (const msg of activeSubscriptions) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(msg);
        }
      }
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string) as IncomingMessage;
        if (msg.channel) dispatch(msg);
      } catch {
        /* ignore malformed */
      }
    });

    ws.addEventListener('close', () => {
      ws = null;
      if (!closed && shouldReconnect) {
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
          connect();
        }, reconnectDelay);
      }
    });

    ws.addEventListener('error', () => {
      // The 'close' event will fire after this, triggering reconnect
    });
  }

  connect();

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
        const remainingScoped = scopedListeners.get(key)?.size ?? 0;
        if (remainingScoped === 0) {
          sendSub('unsubscribe', channel, id);
        }
      };
    },

    subscribeGlobal(channel: string, callback: GlobalCallback): () => void {
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
