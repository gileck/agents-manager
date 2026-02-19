import type { GitLogEntry } from '../../shared/types';
import type { IGitOps } from '../interfaces/git-ops';

export class StubGitOps implements IGitOps {
  private branches: string[] = ['main'];
  private currentBranch = 'main';
  private commits: Array<{ hash: string; message: string }> = [];
  private commitCounter = 0;

  async fetch(_remote?: string): Promise<void> {
    // no-op in stub
  }

  async createBranch(name: string, _baseBranch?: string): Promise<void> {
    this.branches.push(name);
    this.currentBranch = name;
  }

  async checkout(branch: string): Promise<void> {
    this.currentBranch = branch;
  }

  async push(_branch: string, _force?: boolean): Promise<void> {
    // no-op in stub
  }

  async pull(_branch: string): Promise<void> {
    // no-op in stub
  }

  async diff(_fromRef: string, _toRef?: string): Promise<string> {
    return 'diff --git a/file.ts b/file.ts\n+stub change';
  }

  async diffStat(_fromRef: string, _toRef?: string): Promise<string> {
    return ' file.ts | 1 +\n 1 file changed, 1 insertion(+)';
  }

  async commit(message: string): Promise<string> {
    this.commitCounter++;
    const hash = `stub${this.commitCounter.toString().padStart(6, '0')}`;
    this.commits.push({ hash, message });
    return hash;
  }

  async log(count?: number): Promise<GitLogEntry[]> {
    const entries = this.commits.slice(-(count ?? 10)).reverse();
    return entries.map((c) => ({
      hash: c.hash,
      subject: c.message,
      author: 'stub',
      date: new Date().toISOString(),
    }));
  }

  async rebase(_onto: string): Promise<void> {
    // no-op in stub
  }

  async getCurrentBranch(): Promise<string> {
    return this.currentBranch;
  }

  async clean(): Promise<void> {
    // no-op in stub
  }
}
