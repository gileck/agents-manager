import { app, Tray } from 'electron';
import { initializeApp } from '@template/main/core/app';
import { createTray, buildStandardMenu } from '@template/main/core/tray';
import { initDatabase, closeDatabase, getDatabase } from '@template/main/services/database';
import { registerIpcHandlers } from './ipc-handlers';
import { getMigrations } from './migrations';
import { createAppServices, type AppServices } from './providers/setup';

// Keep a global reference to prevent garbage collection
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
    closeDatabase();
  },
});
