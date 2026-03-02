import { openDatabase } from '../core/db';
import { createAppServices } from '../core/providers/setup';
import { createServer } from './server';
import { DaemonWsServer } from './ws/ws-server';
import { WS_CHANNELS } from './ws/channels';
import { startSupervisors, stopSupervisors } from './lifecycle';
import { stopAllBots, autoStartTelegramBots } from './routes/telegram';

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

  services.appLogger.info('daemon', 'Daemon starting');

  // Create the HTTP server and Express app
  const { httpServer } = createServer(services, wsHolder);

  // Attach WebSocket server to the HTTP server
  const wsServer = new DaemonWsServer(httpServer);
  wsHolder.server = wsServer;

  // Start background supervisors
  startSupervisors(services);

  // Auto-start Telegram bots for projects with config
  autoStartTelegramBots(services, wsHolder).catch(err => {
    services.appLogger.logError('daemon', 'Failed to auto-start Telegram bots', err);
  });

  // Recover orphaned agent runs from previous daemon session
  services.agentService.recoverOrphanedRuns().then((interrupted) => {
    if (interrupted.length > 0) {
      services.appLogger.info('daemon', `Recovered ${interrupted.length} orphaned agent run(s)`);
      wsServer.broadcast(WS_CHANNELS.AGENT_INTERRUPTED_RUNS, undefined, interrupted);
    }
  }).catch((err) => {
    services.appLogger.logError('daemon', 'Failed to recover orphaned runs', err);
  });

  // Start listening — dual-output so operators can see daemon lifecycle on stdout/stderr
  httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`Daemon listening on http://127.0.0.1:${PORT}`);
    services.appLogger.info('daemon', `Daemon listening on http://127.0.0.1:${PORT}`);
  });

  // Graceful shutdown
  let shutdownInProgress = false;
  const shutdown = async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    console.log('Shutting down daemon...');
    services.appLogger.info('daemon', 'Daemon shutting down');
    await stopAllBots().catch(err => {
      services.appLogger.logError('daemon', 'Failed to stop Telegram bots', err);
    });
    stopSupervisors(services);

    // Drain running agents before closing connections
    try {
      const drainTimeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
      await Promise.race([
        Promise.all([
          services.agentService.stopAllRunningAgents(),
          Promise.resolve(services.chatAgentService.stopAll()),
        ]),
        drainTimeout,
      ]);
    } catch (err) {
      const drainMsg = err instanceof Error ? err.message : String(err);
      console.warn('Agent drain failed:', drainMsg);
      services.appLogger.warn('daemon', 'Agent drain failed', { error: drainMsg });
    }

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

main().catch((err: unknown) => {
  console.error('Daemon failed to start:', err);
  process.exit(1);
});
