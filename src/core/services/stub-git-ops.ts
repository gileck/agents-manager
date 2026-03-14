import type { GitLogEntry, GitCommitDetail } from '../../shared/types';
import type { IGitOps } from '../interfaces/git-ops';

export class StubGitOps implements IGitOps {
  private branches: string[] = ['main'];
  private currentBranch = 'main';
  private commits: Array<{ hash: string; message: string }> = [];
  private commitCounter = 0;
  private failures: Partial<Record<string, Error>> = {};
  diffOverride?: string | string[];
  statusOverride?: string;
  mergeBaseOverride?: string;
  revParseOverride?: string;
  revParseMap?: Map<string, string>;

  setFailure(method: string, error: Error): void {
    this.failures[method] = error;
  }

  clearFailures(): void {
    this.failures = {};
    this.diffOverride = undefined;
    this.statusOverride = undefined;
    this.mergeBaseOverride = undefined;
    this.revParseOverride = undefined;
    this.revParseMap = undefined;
  }

  private throwIfConfigured(method: string): void {
    const err = this.failures[method];
    if (err) throw err;
  }

  async fetch(_remote?: string, _refspec?: string): Promise<void> {
    this.throwIfConfigured('fetch');
  }

  async createBranch(name: string, _baseBranch?: string): Promise<void> {
    this.throwIfConfigured('createBranch');
    this.branches.push(name);
    this.currentBranch = name;
  }

  async createBranchRef(name: string, _base: string): Promise<void> {
    this.throwIfConfigured('createBranchRef');
    this.branches.push(name);
  }

  async checkout(branch: string): Promise<void> {
    this.throwIfConfigured('checkout');
    this.currentBranch = branch;
  }

  async push(_branch: string, _force?: boolean): Promise<void> {
    this.throwIfConfigured('push');
  }

  async pull(_branch: string, _options?: { ffOnly?: boolean }): Promise<void> {
    this.throwIfConfigured('pull');
  }

  async diff(_fromRef: string, _toRef?: string): Promise<string> {
    this.throwIfConfigured('diff');
    if (Array.isArray(this.diffOverride)) {
      return this.diffOverride.shift() ?? 'diff --git a/file.ts b/file.ts\n+stub change';
    }
    if (this.diffOverride !== undefined) return this.diffOverride;
    return 'diff --git a/file.ts b/file.ts\n+stub change';
  }

  async diffStat(_fromRef: string, _toRef?: string): Promise<string> {
    this.throwIfConfigured('diffStat');
    return ' file.ts | 1 +\n 1 file changed, 1 insertion(+)';
  }

  async commit(message: string): Promise<string> {
    this.throwIfConfigured('commit');
    this.commitCounter++;
    const hash = `stub${this.commitCounter.toString().padStart(6, '0')}`;
    this.commits.push({ hash, message });
    return hash;
  }

  async log(count?: number): Promise<GitLogEntry[]> {
    this.throwIfConfigured('log');
    const entries = this.commits.slice(-(count ?? 10)).reverse();
    return entries.map((c) => ({
      hash: c.hash,
      subject: c.message,
      author: 'stub',
      date: new Date().toISOString(),
    }));
  }

  async rebase(_onto: string): Promise<void> {
    this.throwIfConfigured('rebase');
  }

  async rebaseAbort(): Promise<void> {
    this.throwIfConfigured('rebaseAbort');
  }

  async deleteRemoteBranch(_branch: string): Promise<void> {
    this.throwIfConfigured('deleteRemoteBranch');
  }

  async getCurrentBranch(): Promise<string> {
    this.throwIfConfigured('getCurrentBranch');
    return this.currentBranch;
  }

  async clean(): Promise<void> {
    this.throwIfConfigured('clean');
  }

  async status(): Promise<string> {
    this.throwIfConfigured('status');
    return this.statusOverride ?? '';
  }

  async resetFile(_filepath: string): Promise<void> {
    this.throwIfConfigured('resetFile');
  }

  async showCommit(_hash: string): Promise<string> {
    this.throwIfConfigured('showCommit');
    return '';
  }

  async mergeBase(_ref1: string, _ref2: string): Promise<string> {
    this.throwIfConfigured('mergeBase');
    return this.mergeBaseOverride ?? 'stub-merge-base';
  }

  async revParse(ref: string): Promise<string> {
    this.throwIfConfigured('revParse');
    if (this.revParseMap?.has(ref)) return this.revParseMap.get(ref)!;
    return this.revParseOverride ?? 'stub-rev-parse';
  }

  async getCommitDetail(hash: string): Promise<GitCommitDetail> {
    const commit = this.commits.find((c) => c.hash === hash);
    return {
      hash,
      body: commit ? `Stub body for: ${commit.message}` : '',
      files: [{ status: 'M', path: 'stub/file.ts' }],
    };
  }
}
