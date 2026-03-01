import { app, dialog, Tray } from 'electron';
import { initializeApp } from '@template/main/core/app';
import { createTray, buildStandardMenu } from '@template/main/core/tray';
import { sendToRenderer } from '@template/main/core/window';
import { initDatabase, closeDatabase, getDatabase } from '@template/main/services/database';
import { flushLogs } from '@template/main/services/log-service';
import { registerIpcHandlers } from './ipc-handlers';
import { autoStartTelegramBots } from './ipc-handlers/telegram-handlers';
import { getMigrations } from '../core/migrations';
import { createAppServices, type AppServices } from '../core/providers/setup';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { initShellEnv } from '../core/services/shell-env';
import { DesktopNotificationRouter } from './services/desktop-notification-router';

// Keep a global reference to prevent garbage collection
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tray: Tray | null = null;
let services: AppServices | null = null;

// Set app name so userData path is ~/Library/Application Support/agents-manager/
app.setName('agents-manager');

// Initialize app with template framework
initializeApp({
  singleInstance: true,
  onReady: async () => {
    try {
      // Eagerly resolve the user's shell PATH (async, non-blocking).
      // Populates the cache so subsequent getUserShellPath() calls are instant.
      await initShellEnv();

      // Initialize database with migrations
      initDatabase({
        filename: 'agents-manager.db',
        migrations: getMigrations(),
      });

      // Initialize domain services
      const db = getDatabase();
      services = createAppServices(db, {
        createStreamingCallbacks: (taskId) => ({
          onOutput: (chunk) => sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, chunk),
          onMessage: (msg) => sendToRenderer(IPC_CHANNELS.AGENT_MESSAGE, taskId, msg),
          onStatus: (status) => sendToRenderer(IPC_CHANNELS.AGENT_STATUS, taskId, status),
        }),
        notificationRouters: [new DesktopNotificationRouter()],
      });

      // Register IPC handlers
      registerIpcHandlers(services);

      // Auto-start Telegram bots for projects with enabled config
      autoStartTelegramBots(services).catch(err =>
        console.error('Failed to auto-start Telegram bots:', err)
      );

      // Start the agent supervisor to detect ghost/timed-out runs
      services.agentSupervisor.start();

      // Start the workflow review supervisor to auto-review completed tasks
      services.workflowReviewSupervisor.start(5 * 60 * 1000);

      // Recover orphaned agent runs from previous session
      services.agentService.recoverOrphanedRuns().then((recovered) => {
        if (recovered.length > 0) {
          sendToRenderer(IPC_CHANNELS.AGENT_INTERRUPTED_RUNS, recovered);
        }
      }).catch((err) => {
        console.error('Failed to recover orphaned runs:', err);
      });

      // Create the tray icon with a simple menu
      tray = createTray({
        title: '📝',
        tooltip: 'Agents Manager',
        menuBuilder: () => buildStandardMenu('Agents Manager'),
      });
    } catch (err) {
      console.error('Fatal: onReady failed:', err);
      dialog.showErrorBox(
        'Agents Manager — Startup Failed',
        `Initialization failed:\n${err instanceof Error ? err.message : String(err)}`,
      );
      throw err; // Re-throw to prevent creating a broken window
    }
  },
  onBeforeQuit: () => {
    if (services) {
      services.agentSupervisor.stop();
    }
    // Shutdown ordering: flush buffered log writes BEFORE closing the
    // database connection, otherwise pending inserts silently fail.
    // See docs/patterns.md "Shutdown Ordering" for details.
    flushLogs();
    closeDatabase();
  },
});
