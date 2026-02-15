"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTray = createTray;
exports.updateTrayTitle = updateTrayTitle;
exports.updateContextMenu = updateContextMenu;
exports.getTray = getTray;
exports.buildStandardMenu = buildStandardMenu;
const electron_1 = require("electron");
const window_1 = require("./window");
let tray = null;
function createTray(config) {
    // Create empty icon and use text title instead (most reliable on macOS)
    const icon = electron_1.nativeImage.createEmpty();
    tray = new electron_1.Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip(config.tooltip);
    // Set initial title
    updateTrayTitle(config.title);
    // Click to show context menu (standard macOS menu bar behavior)
    tray.on('click', () => {
        updateContextMenu(config.menuBuilder);
    });
    // Right-click also shows context menu
    tray.on('right-click', () => {
        updateContextMenu(config.menuBuilder);
    });
    return tray;
}
function updateTrayTitle(title) {
    if (!tray)
        return;
    tray.setTitle(title);
}
function updateContextMenu(menuBuilder) {
    if (!tray)
        return;
    const menuItems = menuBuilder();
    const contextMenu = electron_1.Menu.buildFromTemplate(menuItems);
    tray.popUpContextMenu(contextMenu);
}
function getTray() {
    return tray;
}
function buildStandardMenu(statusText, customItems = []) {
    return [
        {
            label: statusText,
            enabled: false,
        },
        { type: 'separator' },
        {
            label: 'Open Dashboard',
            click: () => (0, window_1.showWindow)(),
        },
        { type: 'separator' },
        ...customItems,
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                electron_1.app.quit();
            },
        },
    ];
}
//# sourceMappingURL=tray.js.map