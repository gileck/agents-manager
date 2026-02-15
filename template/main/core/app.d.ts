export interface AppConfig {
    onReady?: () => void | Promise<void>;
    onSecondInstance?: () => void;
    onBeforeQuit?: () => void;
    showWindowOnStart?: boolean;
    singleInstance?: boolean;
}
export declare function initializeApp(config?: AppConfig): void;
export declare function setUpdateInterval(callback: () => void, intervalMs: number): void;
export declare function clearUpdateInterval(): void;
//# sourceMappingURL=app.d.ts.map