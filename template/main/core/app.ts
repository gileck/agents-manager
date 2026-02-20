import { app, BrowserWindow } from 'electron';
import { createWindow, getWindow, showWindow } from './window';

export interface AppConfig {
  onReady?: () => void | Promise<void>;
  onSecondInstance?: () => void;
  onBeforeQuit?: () => void;
  showWindowOnStart?: boolean;
  singleInstance?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let mainWindow: BrowserWindow | null = null;
let updateInterval: NodeJS.Timeout | null = null;

export function initializeApp(config: AppConfig = {}): void {
  const {
    onReady,
    onSecondInstance,
    onBeforeQuit,
    showWindowOnStart = false,
    singleInstance = true,
  } = config;

  // Ensure single instance if requested
  if (singleInstance) {
    const gotTheLock = app.requestSingleInstanceLock();

    if (!gotTheLock) {
      app.quit();
      return;
    } else {
      app.on('second-instance', () => {
        // Someone tried to run a second instance, focus our window
        const window = getWindow();
        if (window) {
          showWindow();
          if (process.env.ELECTRON_DEBUG === '1' || process.env.NODE_ENV === 'development') {
            console.log('Second instance detected, opening DevTools');
            window.webContents.openDevTools({ mode: 'detach' });
          }
        }
        if (onSecondInstance) {
          onSecondInstance();
        }
      });
    }
  }

  // When app is ready
  app.whenReady().then(async () => {
    // Show in dock for Cmd+Tab switching
    // To hide from dock (menu bar only), uncomment: app.dock?.hide();

    // Run custom initialization
    if (onReady) {
      await onReady();
    }

    // Create the window
    mainWindow = createWindow();

    // Show window if requested or in debug mode
    const shouldShow = showWindowOnStart ||
      process.env.ELECTRON_DEBUG === '1' ||
      process.env.NODE_ENV === 'development';

    if (shouldShow) {
      showWindow();
    }
  });

  // macOS: Show window when clicking dock icon
  app.on('activate', () => {
    const window = getWindow();
    if (window) {
      showWindow();
    } else {
      mainWindow = createWindow();
      showWindow();
    }
  });

  // Prevent app from quitting when all windows are closed (menu bar app behavior)
  app.on('window-all-closed', () => {
    // Don't quit - keep running in menu bar
    // No need to call preventDefault, just don't call app.quit()
  });

  // Clean up on quit
  app.on('before-quit', () => {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
    if (onBeforeQuit) {
      onBeforeQuit();
    }
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });
}

export function setUpdateInterval(callback: () => void, intervalMs: number): void {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  updateInterval = setInterval(callback, intervalMs);
}

export function clearUpdateInterval(): void {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}
