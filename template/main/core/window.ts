import { BrowserWindow, screen, app } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    frame: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    backgroundColor: '#ffffff', // Force white background
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(app.getAppPath(), 'dist-main', 'src', 'preload', 'index.js'),
    },
    // Remove standard window buttons for menu bar style (optional)
    // titleBarStyle: 'hidden',
  });

  // Set isQuitting flag when app is about to quit
  app.on('before-quit', () => {
    isQuitting = true;
  });

  const shouldOpenDevTools =
    process.env.ELECTRON_DEBUG === '1' || process.env.NODE_ENV === 'development';

  // Store listener references for cleanup
  const listeners = {
    failLoad: (_event: any, errorCode: number, errorDescription: string, validatedURL: string) => {
      console.error('Renderer failed to load:', { errorCode, errorDescription, validatedURL });
    },
    processGone: (_event: any, details: any) => {
      console.error('Renderer process gone:', details);
    },
    unresponsive: () => {
      console.error('Renderer is unresponsive');
    },
    responsive: () => {
      // Renderer recovered from unresponsive state
    },
  };

  mainWindow.webContents.on('did-fail-load', listeners.failLoad);
  mainWindow.webContents.on('render-process-gone', listeners.processGone);
  mainWindow.webContents.on('unresponsive', listeners.unresponsive);
  mainWindow.webContents.on('responsive', listeners.responsive);

  // Only forward renderer console messages in debug mode
  if (shouldOpenDevTools) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      // Skip noisy React DevTools message
      if (message.includes('Download the React DevTools')) return;
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }

  // Load the renderer
  // Use app.getAppPath() to get the project root directory
  const appPath = app.getAppPath();
  const indexPath = path.join(appPath, 'dist', 'index.html');

  mainWindow.loadFile(indexPath);

  if (shouldOpenDevTools) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    });
  }

  // Hide window instead of closing when user clicks X
  mainWindow.on('close', (event) => {
    if (!mainWindow || isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  // Hide window when it loses focus (menu bar app behavior)
  // Uncomment for strict menu bar popup behavior:
  // mainWindow.on('blur', () => {
  //   hideWindow();
  // });

  mainWindow.on('closed', () => {
    if (mainWindow) {
      mainWindow.webContents.removeListener('did-fail-load', listeners.failLoad);
      mainWindow.webContents.removeListener('render-process-gone', listeners.processGone);
      mainWindow.webContents.removeListener('unresponsive', listeners.unresponsive);
      mainWindow.webContents.removeListener('responsive', listeners.responsive);
    }
    mainWindow = null;
  });

  return mainWindow;
}

export function getWindow(): BrowserWindow | null {
  return mainWindow;
}

export function showWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow();
  }

  // Position window below the tray icon (optional - for menu bar popup style)
  // const trayBounds = tray?.getBounds();
  // if (trayBounds) {
  //   const windowBounds = mainWindow.getBounds();
  //   const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
  //   const y = Math.round(trayBounds.y + trayBounds.height);
  //   mainWindow.setPosition(x, y, false);
  // }

  mainWindow.show();
  mainWindow.focus();
}

export function hideWindow(): void {
  if (mainWindow) {
    mainWindow.hide();
  }
}

export function toggleWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow();
    showWindow();
  } else if (mainWindow.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, ...args);
  }
}
