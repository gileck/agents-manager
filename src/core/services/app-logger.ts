import type { IAppDebugLog } from '../interfaces/app-debug-log';

export class AppLogger {
  constructor(private log: IAppDebugLog) {}

  debug(source: string, message: string, data?: Record<string, unknown>): void {
    this.log.log({ level: 'debug', source, message, data });
  }

  info(source: string, message: string, data?: Record<string, unknown>): void {
    this.log.log({ level: 'info', source, message, data });
  }

  warn(source: string, message: string, data?: Record<string, unknown>): void {
    this.log.log({ level: 'warn', source, message, data });
  }

  error(source: string, message: string, data?: Record<string, unknown>): void {
    this.log.log({ level: 'error', source, message, data });
  }

  logError(source: string, message: string, err: unknown): void {
    const data: Record<string, unknown> = {};
    if (err instanceof Error) {
      data.error = err.message;
      if (err.stack) data.stack = err.stack;
    } else {
      data.error = String(err);
    }
    this.log.log({ level: 'error', source, message, data });
  }
}
