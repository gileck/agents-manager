import { Tray, Menu, nativeImage, app, MenuItemConstructorOptions } from 'electron';
import { showWindow } from './window';

let tray: Tray | null = null;

export interface TrayConfig {
  icon?: string;
  title: string;
  tooltip: string;
  menuBuilder: () => MenuItemConstructorOptions[];
}

export function createTray(config: TrayConfig): Tray {
  // Create empty icon and use text title instead (most reliable on macOS)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
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

export function updateTrayTitle(title: string): void {
  if (!tray) return;
  tray.setTitle(title);
}

export function updateContextMenu(menuBuilder: () => MenuItemConstructorOptions[]): void {
  if (!tray) return;

  const menuItems = menuBuilder();
  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.popUpContextMenu(contextMenu);
}

export function getTray(): Tray | null {
  return tray;
}

export function buildStandardMenu(
  statusText: string,
  customItems: MenuItemConstructorOptions[] = []
): MenuItemConstructorOptions[] {
  return [
    {
      label: statusText,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => showWindow(),
    },
    { type: 'separator' },
    ...customItems,
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ];
}
