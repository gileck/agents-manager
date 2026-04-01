import { BrowserWindow, app } from 'electron';
import * as path from 'path';

/** Map of projectId → BrowserWindow. Key '__default__' for windows without a project. */
const windows = new Map<string, BrowserWindow>();
let isQuitting = false;

// Track the most recently focused window for activate/second-instance
let lastFocusedKey: string | null = null;

// Register once at module level to prevent duplicate listener accumulation
// when createWindow() is called multiple times (e.g. from activate or showWindow).
app.on('before-quit', () => {
  isQuitting = true;
});

function windowKey(projectId?: string): string {
  return projectId || '__default__';
}

export function createWindow(projectId?: string): BrowserWindow {
  const key = windowKey(projectId);

  // If a window already exists for this project, return it
  const existing = windows.get(key);
  if (existing && !existing.isDestroyed()) {
    return existing;
  }

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    frame: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(app.getAppPath(), 'dist-main', 'src', 'preload', 'index.js'),
    },
  });

  const shouldOpenDevTools =
    process.env.ELECTRON_DEBUG === '1' || process.env.NODE_ENV === 'development';

  // Store listener references for cleanup
  const listeners = {
    failLoad: (_event: Electron.Event, errorCode: number, errorDescription: string, validatedURL: string) => {
      console.error('Renderer failed to load:', { errorCode, errorDescription, validatedURL });
    },
    processGone: (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
      console.error('Renderer process gone:', details);
    },
    unresponsive: () => {
      console.error('Renderer is unresponsive');
    },
    responsive: () => {
      // Renderer recovered from unresponsive state
    },
  };

  win.webContents.on('did-fail-load', listeners.failLoad);
  win.webContents.on('render-process-gone', listeners.processGone);
  win.webContents.on('unresponsive', listeners.unresponsive);
  win.webContents.on('responsive', listeners.responsive);

  // Only forward renderer console messages in debug mode
  if (shouldOpenDevTools) {
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      // Skip noisy React DevTools message
      if (message.includes('Download the React DevTools')) return;
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }

  // Load the renderer with projectId as query parameter
  const appPath = app.getAppPath();
  const indexPath = path.join(appPath, 'dist', 'index.html');

  const loadPromise = projectId
    ? win.loadFile(indexPath, { search: `?projectId=${encodeURIComponent(projectId)}` })
    : win.loadFile(indexPath);
  loadPromise.catch((err) => {
    console.error(`Failed to load renderer${projectId ? ` for project ${projectId}` : ''}:`, err);
  });

  if (shouldOpenDevTools) {
    win.webContents.once('did-finish-load', () => {
      win?.webContents.openDevTools({ mode: 'detach' });
    });
  }

  // Hide window instead of closing when user clicks X
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });

  // Track focus for last-focused tracking
  win.on('focus', () => {
    lastFocusedKey = key;
  });

  win.on('closed', () => {
    win.webContents.removeListener('did-fail-load', listeners.failLoad);
    win.webContents.removeListener('render-process-gone', listeners.processGone);
    win.webContents.removeListener('unresponsive', listeners.unresponsive);
    win.webContents.removeListener('responsive', listeners.responsive);
    windows.delete(key);
    if (lastFocusedKey === key) {
      lastFocusedKey = null;
    }
  });

  windows.set(key, win);
  lastFocusedKey = key;

  return win;
}

export function getWindow(projectId?: string): BrowserWindow | null {
  if (projectId) {
    const win = windows.get(windowKey(projectId));
    return win && !win.isDestroyed() ? win : null;
  }
  // No projectId: return last focused, or first available
  if (lastFocusedKey) {
    const win = windows.get(lastFocusedKey);
    if (win && !win.isDestroyed()) return win;
  }
  for (const win of windows.values()) {
    if (!win.isDestroyed()) return win;
  }
  return null;
}

export function getAllWindows(): BrowserWindow[] {
  return Array.from(windows.values()).filter(w => !w.isDestroyed());
}

export function showWindow(projectId?: string): void {
  let win = getWindow(projectId);
  if (!win) {
    win = createWindow(projectId);
  }
  win.show();
  win.focus();
}

export function hideWindow(projectId?: string): void {
  const win = getWindow(projectId);
  if (win) {
    win.hide();
  }
}

export function toggleWindow(projectId?: string): void {
  const win = getWindow(projectId);
  if (!win) {
    createWindow(projectId);
    showWindow(projectId);
  } else if (win.isVisible()) {
    hideWindow(projectId);
  } else {
    showWindow(projectId);
  }
}

/** Send an IPC message to all open renderer windows. */
export function broadcastToAllWindows(channel: string, ...args: unknown[]): void {
  for (const win of windows.values()) {
    if (!win.isDestroyed() && win.webContents) {
      try {
        win.webContents.send(channel, ...args);
      } catch (err) {
        console.error(`Failed to send ${channel} to window:`, err);
      }
    }
  }
}

/** @deprecated Use broadcastToAllWindows instead */
export function sendToRenderer(channel: string, ...args: unknown[]): void {
  broadcastToAllWindows(channel, ...args);
}

export function closeAllWindows(): void {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
  windows.clear();
}

export function hasAnyWindow(): boolean {
  return getAllWindows().length > 0;
}
