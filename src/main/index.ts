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

// Initialize app with template framework
initializeApp({
  singleInstance: true,
  onReady: async () => {
    // Initialize database with migrations
    initDatabase({
      filename: 'app.db',
      migrations: getMigrations(),
    });

    // Initialize domain services
    const db = getDatabase();
    services = createAppServices(db);

    // Register IPC handlers
    registerIpcHandlers();

    // Create the tray icon with a simple menu
    tray = createTray({
      title: '📝',
      tooltip: 'MacOS App Template',
      menuBuilder: () => buildStandardMenu('MacOS App Template'),
    });
  },
  onBeforeQuit: () => {
    closeDatabase();
  },
});
