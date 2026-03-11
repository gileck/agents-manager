import { openDatabase } from '../core/db';
import { createAppServices } from '../core/providers/setup';
import { createServer } from './server';
import { DaemonWsServer } from './ws/ws-server';
import { WS_CHANNELS } from './ws/channels';
import { startSupervisors, stopSupervisors } from './lifecycle';
import { stopAllBots, autoStartTelegramBots } from './routes/telegram';
import { InAppNotificationRouter } from '../core/services/in-app-notification-router';
import { getAppLogger } from '../core/services/app-logger';

const PORT = parseInt(process.env.AM_DAEMON_PORT ?? '3847', 10);

// Capture unhandled errors via app logger (falls back to console → daemon.log before DB init)
process.on('uncaughtException', (err) => {
  getAppLogger().logError('daemon', 'Uncaught exception', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  getAppLogger().logError('daemon', 'Unhandled rejection', err);
});

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
    onMainDiverged: (projectId: string) => {
      wsHolder.server?.broadcast(WS_CHANNELS.MAIN_DIVERGED, undefined, { projectId });
    },
    devServerCallbacks: {
      onLog: (taskId: string, line: string) => {
        wsHolder.server?.broadcast(WS_CHANNELS.DEV_SERVER_LOG, taskId, { line });
      },
      onStatusChange: (info) => {
        wsHolder.server?.broadcast(WS_CHANNELS.DEV_SERVER_STATUS, info.taskId, info);
      },
    },
    onAgentSubscriptionFired: (sessionId, payload) => {
      wsHolder.server?.broadcast(WS_CHANNELS.CHAT_AGENT_NOTIFICATION, sessionId, payload);
    },
  });

  // Register in-app notification router (lazily broadcasts via WS once server is ready)
  const inAppRouter = new InAppNotificationRouter(
    services.inAppNotificationStore,
    (type, payload) => { wsHolder.server?.broadcast(type, undefined, payload); },
  );
  services.notificationRouter.addRouter(inAppRouter);

  services.appLogger.info('daemon', 'Daemon starting');

  // Create the HTTP server and Express app
  const { httpServer } = createServer(services, wsHolder);

  // Attach WebSocket server to the HTTP server
  const wsServer = new DaemonWsServer(httpServer);
  wsHolder.server = wsServer;

  // Wire injected event handler so Tier 2 injected messages stream to the correct WS channels
  services.chatAgentService.setInjectedEventHandler((sessionId) => {
    return (event: import('../shared/types').ChatAgentEvent) => {
      if (event.type === 'text') {
        wsServer.broadcast(WS_CHANNELS.CHAT_OUTPUT, sessionId, event.text);
      } else if (event.type === 'message') {
        wsServer.broadcast(WS_CHANNELS.CHAT_MESSAGE, sessionId, event.message);
      }
    };
  });

  // Recover orphaned agent runs from previous daemon session (before starting supervisors
  // to eliminate the race where the supervisor's first poll sees orphaned runs from a prior crash)
  let interruptedRuns: import('../shared/types').AgentRun[] = [];
  try {
    interruptedRuns = await services.agentService.recoverOrphanedRuns();
    if (interruptedRuns.length > 0) {
      services.appLogger.info('daemon', `Recovered ${interruptedRuns.length} orphaned agent run(s) — will auto-resume`);
      wsServer.broadcast(WS_CHANNELS.AGENT_INTERRUPTED_RUNS, undefined, interruptedRuns);
    }
  } catch (err) {
    services.appLogger.logError('daemon', 'Failed to recover orphaned runs', err);
  }

  // Start background supervisors
  startSupervisors(services);

  // Auto-resume interrupted agents after daemon is fully initialized.
  // Delay allows supervisors, bots, and WebSocket to be ready before agent execution starts.
  if (interruptedRuns.length > 0) {
    setTimeout(() => {
      Promise.allSettled(
        interruptedRuns.map(async (run) => {
          try {
            services.appLogger.info('daemon', `Auto-resuming interrupted agent for task ${run.taskId} (run ${run.id}, ${run.agentType})`, { taskId: run.taskId, runId: run.id, agentType: run.agentType });
            // Set pending resume right before starting — not in recoverOrphanedRuns — to avoid race with supervisor
            services.agentService.setPendingResume(run.taskId, run);
            await services.workflowService.startAgent(run.taskId, run.mode as import('../shared/types').AgentMode, run.agentType);
          } catch (err) {
            services.agentService.clearPendingResume(run.taskId);
            services.appLogger.logError('daemon', `Failed to auto-resume agent for task ${run.taskId}`, err);
          }
        })
      ).catch(err => {
        services.appLogger.logError('daemon', 'Auto-resume batch failed unexpectedly', err);
      });
    }, 3000);
  }

  // Auto-start Telegram bots for projects with config
  autoStartTelegramBots(services, wsHolder).catch(err => {
    services.appLogger.logError('daemon', 'Failed to auto-start Telegram bots', err);
  });

  httpServer.listen(PORT, '127.0.0.1', () => {
    services.appLogger.info('daemon', `Daemon listening on http://127.0.0.1:${PORT}`);
  });

  // Graceful shutdown
  let shutdownInProgress = false;
  const shutdown = async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    services.appLogger.info('daemon', 'Daemon shutting down');
    await stopAllBots().catch(err => {
      services.appLogger.logError('daemon', 'Failed to stop Telegram bots', err);
    });
    stopSupervisors(services);

    // Stop all dev servers
    await services.devServerManager.stopAll().catch(err => {
      services.appLogger.logError('daemon', 'Failed to stop dev servers', err);
    });

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
      services.appLogger.logError('daemon', 'Agent drain failed', err);
    }

    services.subscriptionRegistry.dispose();
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
  getAppLogger().logError('daemon', 'Daemon failed to start', err);
  process.exit(1);
});
