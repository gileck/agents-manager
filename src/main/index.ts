import { app, Tray } from 'electron';
import { initializeApp } from '@template/main/core/app';
import { createTray, buildStandardMenu } from '@template/main/core/tray';
import { sendToRenderer } from '@template/main/core/window';
import { initDatabase, closeDatabase, getDatabase } from '@template/main/services/database';
import { registerIpcHandlers } from './ipc-handlers';
import { getMigrations } from './migrations';
import { createAppServices, type AppServices } from './providers/setup';
import { IPC_CHANNELS } from '../shared/ipc-channels';

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
      // Initialize database with migrations
      initDatabase({
        filename: 'agents-manager.db',
        migrations: getMigrations(),
      });

      // Initialize domain services
      const db = getDatabase();
      services = createAppServices(db);

      // Register IPC handlers
      registerIpcHandlers(services);

      // Start the agent supervisor to detect ghost/timed-out runs
      services.agentSupervisor.start();

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
    }
  },
  onBeforeQuit: () => {
    if (services) {
      services.agentSupervisor.stop();
    }
    closeDatabase();
  },
});
