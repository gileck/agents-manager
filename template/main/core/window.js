"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWindow = createWindow;
exports.getWindow = getWindow;
exports.showWindow = showWindow;
exports.hideWindow = hideWindow;
exports.toggleWindow = toggleWindow;
exports.sendToRenderer = sendToRenderer;
const electron_1 = require("electron");
const path = __importStar(require("path"));
let mainWindow = null;
let isQuitting = false;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
            preload: path.join(__dirname, '..', 'preload', 'index.js'),
        },
        // Remove standard window buttons for menu bar style (optional)
        // titleBarStyle: 'hidden',
    });
    // Set isQuitting flag when app is about to quit
    electron_1.app.on('before-quit', () => {
        isQuitting = true;
    });
    const shouldOpenDevTools = process.env.ELECTRON_DEBUG === '1' || process.env.NODE_ENV === 'development';
    // Store listener references for cleanup
    const listeners = {
        failLoad: (_event, errorCode, errorDescription, validatedURL) => {
            console.error('Renderer failed to load:', { errorCode, errorDescription, validatedURL });
        },
        processGone: (_event, details) => {
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
            if (message.includes('Download the React DevTools'))
                return;
            console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
        });
    }
    // Load the renderer
    const indexPath = path.join(__dirname, '..', '..', 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
    if (shouldOpenDevTools) {
        mainWindow.webContents.once('did-finish-load', () => {
            mainWindow?.webContents.openDevTools({ mode: 'detach' });
        });
    }
    // Hide window instead of closing when user clicks X
    mainWindow.on('close', (event) => {
        if (!mainWindow || isQuitting)
            return;
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
function getWindow() {
    return mainWindow;
}
function showWindow() {
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
function hideWindow() {
    if (mainWindow) {
        mainWindow.hide();
    }
}
function toggleWindow() {
    if (!mainWindow) {
        mainWindow = createWindow();
        showWindow();
    }
    else if (mainWindow.isVisible()) {
        hideWindow();
    }
    else {
        showWindow();
    }
}
function sendToRenderer(channel, ...args) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send(channel, ...args);
    }
}
//# sourceMappingURL=window.js.map