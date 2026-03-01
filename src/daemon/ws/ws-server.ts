import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { WS_CHANNELS } from './channels';

export class DaemonWsServer {
  private wss: WebSocketServer;
  private subscriptions = new Map<WebSocket, Set<string>>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  private handleConnection(ws: WebSocket): void {
    this.subscriptions.set(ws, new Set());

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe' && msg.channel) {
          const key = msg.id ? `${msg.channel}:${msg.id}` : msg.channel;
          this.subscriptions.get(ws)?.add(key);
        } else if (msg.type === 'unsubscribe' && msg.channel) {
          const key = msg.id ? `${msg.channel}:${msg.id}` : msg.channel;
          this.subscriptions.get(ws)?.delete(key);
        }
      } catch {
        /* ignore malformed messages */
      }
    });

    ws.on('close', () => this.subscriptions.delete(ws));
  }

  broadcast(channel: string, id: string | undefined, data: unknown): void {
    const keyWithId = id ? `${channel}:${id}` : channel;
    const msg = JSON.stringify({ channel, id, data });

    for (const [ws, subs] of this.subscriptions) {
      if (
        ws.readyState === WebSocket.OPEN &&
        (subs.has(channel) || subs.has(keyWithId) || subs.has(`${channel}:*`))
      ) {
        ws.send(msg);
      }
    }
  }

  createStreamingCallbacks(taskId: string) {
    return {
      onOutput: (chunk: string) => this.broadcast(WS_CHANNELS.AGENT_OUTPUT, taskId, chunk),
      onMessage: (msg: unknown) => this.broadcast(WS_CHANNELS.AGENT_MESSAGE, taskId, msg),
      onStatus: (status: string) => this.broadcast(WS_CHANNELS.AGENT_STATUS, taskId, status),
    };
  }

  close(): void {
    this.wss.close();
  }
}
