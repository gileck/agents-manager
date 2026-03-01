import { openDatabase } from '../core/db';
import { createAppServices } from '../core/providers/setup';
import { createServer } from './server';
import { DaemonWsServer } from './ws/ws-server';
import { WS_CHANNELS } from './ws/channels';
import { startSupervisors, stopSupervisors } from './lifecycle';
import { stopAllBots } from './routes/telegram';

const PORT = parseInt(process.env.AM_DAEMON_PORT ?? '3847', 10);

async function main() {
  // Open the database using the shared core initializer
  const db = openDatabase();

  // Mutable holder so the streaming callbacks can reference the WS server
  // after it has been created (it depends on the HTTP server which is created later).
  const wsHolder: { server?: DaemonWsServer } = {};

  const services = createAppServices(db, {
    createStreamingCallbacks: (taskId: string) => {
      if (!wsHolder.server) {
        return {
          onOutput: () => {},
          onMessage: () => {},
          onStatus: () => {},
        };
      }
      return wsHolder.server.createStreamingCallbacks(taskId);
    },
  });

  // Create the HTTP server and Express app
  const { httpServer } = createServer(services, wsHolder);

  // Attach WebSocket server to the HTTP server
  const wsServer = new DaemonWsServer(httpServer);
  wsHolder.server = wsServer;

  // Start background supervisors
  startSupervisors(services);

  // Recover orphaned agent runs from previous daemon session
  services.agentService.recoverOrphanedRuns().then((interrupted) => {
    if (interrupted.length > 0) {
      console.log(`Recovered ${interrupted.length} orphaned agent run(s).`);
      wsServer.broadcast(WS_CHANNELS.AGENT_INTERRUPTED_RUNS, undefined, interrupted);
    }
  }).catch((err) => {
    console.error('Failed to recover orphaned runs:', err);
  });

  // Start listening
  httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`Daemon listening on http://127.0.0.1:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down daemon...');
    await stopAllBots().catch(err => console.warn('Failed to stop Telegram bots:', err));
    stopSupervisors(services);
    wsServer.close();
    httpServer.closeAllConnections();
    httpServer.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Daemon failed to start:', err);
  process.exit(1);
});
