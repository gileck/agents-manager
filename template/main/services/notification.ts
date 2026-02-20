import { Notification, BrowserWindow, NotificationConstructorOptions } from 'electron';
import { showWindow } from '../core/window';

export interface NotificationAction {
  type: 'button';
  text: string;
}

export interface NotificationOptions extends NotificationConstructorOptions {
  actions?: NotificationAction[];
  onAction?: (event: Electron.Event, index: number) => void;
  onClick?: () => void;
  onClose?: () => void;
}

export function isNotificationsSupported(): boolean {
  return Notification.isSupported();
}

export function sendNotification(
  title: string,
  body: string,
  options?: NotificationOptions
): void {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
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
  } else {
    // Default: show window on click
    notification.on('click', () => {
      showWindow();
    });
  }

  if (options?.onClose) {
    notification.on('close', options.onClose);
  }

  notification.show();
}

export function navigateToRoute(route: string, channel: string = 'NAVIGATE'): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send(channel, route);
  }
}
