import { Tray, MenuItemConstructorOptions } from 'electron';
export interface TrayConfig {
    icon?: string;
    title: string;
    tooltip: string;
    menuBuilder: () => MenuItemConstructorOptions[];
}
export declare function createTray(config: TrayConfig): Tray;
export declare function updateTrayTitle(title: string): void;
export declare function updateContextMenu(menuBuilder: () => MenuItemConstructorOptions[]): void;
export declare function getTray(): Tray | null;
export declare function buildStandardMenu(statusText: string, customItems?: MenuItemConstructorOptions[]): MenuItemConstructorOptions[];
//# sourceMappingURL=tray.d.ts.map