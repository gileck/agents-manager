import { openDatabase } from '../core/db';
import { createAppServices } from '../core/providers/setup';
import { createServer } from './server';
import { DaemonWsServer } from './ws/ws-server';
import { startSupervisors, stopSupervisors } from './lifecycle';

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
  const { httpServer } = createServer(services);

  // Attach WebSocket server to the HTTP server
  const wsServer = new DaemonWsServer(httpServer);
  wsHolder.server = wsServer;

  // Start background supervisors
  startSupervisors(services);

  // Start listening
  httpServer.listen(PORT, () => {
    console.log(`Daemon listening on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down daemon...');
    stopSupervisors(services);
    wsServer.close();
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
