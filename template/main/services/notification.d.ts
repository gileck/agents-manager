import { NotificationConstructorOptions } from 'electron';
export interface NotificationAction {
    type: 'button';
    text: string;
}
export interface NotificationOptions extends NotificationConstructorOptions {
    actions?: NotificationAction[];
    onAction?: (event: any, index: number) => void;
    onClick?: () => void;
    onClose?: () => void;
}
export declare function isNotificationsSupported(): boolean;
export declare function sendNotification(title: string, body: string, options?: NotificationOptions): void;
export declare function navigateToRoute(route: string, channel?: string): void;
//# sourceMappingURL=notification.d.ts.map