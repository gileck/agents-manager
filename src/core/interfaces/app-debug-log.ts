import type { AppDebugLogEntry, AppDebugLogCreateInput, AppDebugLogFilter } from '../../shared/types';

export interface IAppDebugLog {
  /** Synchronous fire-and-forget insert — never throws. */
  log(input: AppDebugLogCreateInput): void;
  getEntries(filter?: AppDebugLogFilter): Promise<AppDebugLogEntry[]>;
  /** Delete entries, optionally only those older than `olderThanMs` milliseconds. Returns deleted count. */
  clear(olderThanMs?: number): Promise<number>;
}
