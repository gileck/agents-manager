"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNotificationsSupported = isNotificationsSupported;
exports.sendNotification = sendNotification;
exports.navigateToRoute = navigateToRoute;
const electron_1 = require("electron");
const window_1 = require("../core/window");
function isNotificationsSupported() {
    return electron_1.Notification.isSupported();
}
function sendNotification(title, body, options) {
    if (!electron_1.Notification.isSupported())
        return;
    const notification = new electron_1.Notification({
        title,
        body,
        silent: options?.silent ?? false,
        actions: options?.actions,
        ...options,
    });
    if (options?.onAction) {
        notification.on('action', options.onAction);
    }
    if (options?.onClick) {
        notification.on('click', options.onClick);
    }
    else {
        // Default: show window on click
        notification.on('click', () => {
            (0, window_1.showWindow)();
        });
    }
    if (options?.onClose) {
        notification.on('close', options.onClose);
    }
    notification.show();
}
function navigateToRoute(route, channel = 'NAVIGATE') {
    const win = electron_1.BrowserWindow.getAllWindows()[0];
    if (win) {
        win.webContents.send(channel, route);
    }
}
//# sourceMappingURL=notification.js.map