import type { GitLogEntry } from '../../shared/types';

export interface IGitOps {
  createBranch(name: string, baseBranch?: string): Promise<void>;
  checkout(branch: string): Promise<void>;
  push(branch: string, force?: boolean): Promise<void>;
  pull(branch: string): Promise<void>;
  diff(fromRef: string, toRef?: string): Promise<string>;
  commit(message: string): Promise<string>;
  log(count?: number): Promise<GitLogEntry[]>;
  getCurrentBranch(): Promise<string>;
}
