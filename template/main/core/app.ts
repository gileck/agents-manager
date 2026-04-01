import { app } from 'electron';
import { createWindow, getWindow, showWindow, getAllWindows, hasAnyWindow } from './window';

export interface AppConfig {
  onReady?: () => void | Promise<void>;
  onSecondInstance?: () => void;
  onBeforeQuit?: () => void;
  showWindowOnStart?: boolean;
  singleInstance?: boolean;
}

let updateInterval: NodeJS.Timeout | null = null;
let isInitialized = false;

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
        // Someone tried to run a second instance — show/focus existing windows
        const allWindows = getAllWindows();
        if (allWindows.length > 0) {
          // Show and focus the most recently used window
          showWindow();
          const win = getWindow();
          if (win && (process.env.ELECTRON_DEBUG === '1' || process.env.NODE_ENV === 'development')) {
            console.log('Second instance detected, opening DevTools');
            win.webContents.openDevTools({ mode: 'detach' });
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

    isInitialized = true;

    // Create a default window (no projectId — renderer will read from settings)
    createWindow();

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
    if (!isInitialized) return;
    if (hasAnyWindow()) {
      showWindow(); // Shows last-focused or first available
    } else {
      createWindow();
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
