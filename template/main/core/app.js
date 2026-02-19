"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeApp = initializeApp;
exports.setUpdateInterval = setUpdateInterval;
exports.clearUpdateInterval = clearUpdateInterval;
const electron_1 = require("electron");
const window_1 = require("./window");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let mainWindow = null;
let updateInterval = null;
function initializeApp(config = {}) {
    const { onReady, onSecondInstance, onBeforeQuit, showWindowOnStart = false, singleInstance = true, } = config;
    // Ensure single instance if requested
    if (singleInstance) {
        const gotTheLock = electron_1.app.requestSingleInstanceLock();
        if (!gotTheLock) {
            electron_1.app.quit();
            return;
        }
        else {
            electron_1.app.on('second-instance', () => {
                // Someone tried to run a second instance, focus our window
                const window = (0, window_1.getWindow)();
                if (window) {
                    (0, window_1.showWindow)();
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
    electron_1.app.whenReady().then(async () => {
        // Show in dock for Cmd+Tab switching
        // To hide from dock (menu bar only), uncomment: app.dock?.hide();
        // Run custom initialization
        if (onReady) {
            await onReady();
        }
        // Create the window
        mainWindow = (0, window_1.createWindow)();
        // Show window if requested or in debug mode
        const shouldShow = showWindowOnStart ||
            process.env.ELECTRON_DEBUG === '1' ||
            process.env.NODE_ENV === 'development';
        if (shouldShow) {
            (0, window_1.showWindow)();
        }
    });
    // macOS: Show window when clicking dock icon
    electron_1.app.on('activate', () => {
        const window = (0, window_1.getWindow)();
        if (window) {
            (0, window_1.showWindow)();
        }
        else {
            mainWindow = (0, window_1.createWindow)();
            (0, window_1.showWindow)();
        }
    });
    // Prevent app from quitting when all windows are closed (menu bar app behavior)
    electron_1.app.on('window-all-closed', () => {
        // Don't quit - keep running in menu bar
        // No need to call preventDefault, just don't call app.quit()
    });
    // Clean up on quit
    electron_1.app.on('before-quit', () => {
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
function setUpdateInterval(callback, intervalMs) {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    updateInterval = setInterval(callback, intervalMs);
}
function clearUpdateInterval() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}
//# sourceMappingURL=app.js.map