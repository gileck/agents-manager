import { BrowserWindow } from 'electron';
export declare function createWindow(): BrowserWindow;
export declare function getWindow(): BrowserWindow | null;
export declare function showWindow(): void;
export declare function hideWindow(): void;
export declare function toggleWindow(): void;
export declare function sendToRenderer(channel: string, ...args: unknown[]): void;
//# sourceMappingURL=window.d.ts.map