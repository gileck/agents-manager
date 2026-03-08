import type { IAppDebugLog } from '../interfaces/app-debug-log';

export class AppLogger {
  private verbose: boolean;

  constructor(private log: IAppDebugLog, opts?: { verbose?: boolean }) {
    this.verbose = opts?.verbose ?? false;
  }

  debug(source: string, message: string, data?: Record<string, unknown>): void {
    this.log.log({ level: 'debug', source, message, data });
  }

  info(source: string, message: string, data?: Record<string, unknown>): void {
    this.log.log({ level: 'info', source, message, data });
    if (this.verbose) this.toConsole(console.log, source, message, data);
  }

  warn(source: string, message: string, data?: Record<string, unknown>): void {
    this.log.log({ level: 'warn', source, message, data });
    if (this.verbose) this.toConsole(console.warn, source, message, data);
  }

  error(source: string, message: string, data?: Record<string, unknown>): void {
    this.log.log({ level: 'error', source, message, data });
    if (this.verbose) this.toConsole(console.error, source, message, data);
  }

  private toConsole(fn: (...args: unknown[]) => void, source: string, message: string, data?: Record<string, unknown>): void {
    if (data) { fn(`[${source}] ${message}`, data); } else { fn(`[${source}] ${message}`); }
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
    if (this.verbose) {
      console.error(`[${source}] ${message}`, err);
    }
  }
}

// --- Module-level singleton ---

let _instance: AppLogger | null = null;

// Console-based fallback for pre-init period.
// debug is intentionally silent — debug-level noise before logger init is dropped.
const _fallback = {
  debug: (_s: string, _m: string, _d?: Record<string, unknown>) => {},
  info: (s: string, m: string, d?: Record<string, unknown>) => d ? console.log(`[${s}] ${m}`, d) : console.log(`[${s}] ${m}`),
  warn: (s: string, m: string, d?: Record<string, unknown>) => d ? console.warn(`[${s}] ${m}`, d) : console.warn(`[${s}] ${m}`),
  error: (s: string, m: string, d?: Record<string, unknown>) => d ? console.error(`[${s}] ${m}`, d) : console.error(`[${s}] ${m}`),
  logError: (s: string, m: string, err: unknown) => console.error(`[${s}] ${m}`, err),
} as AppLogger;

export function initAppLogger(log: IAppDebugLog, opts?: { verbose?: boolean }): AppLogger {
  _instance = new AppLogger(log, opts);
  return _instance;
}

export function getAppLogger(): AppLogger {
  return _instance ?? _fallback;
}
