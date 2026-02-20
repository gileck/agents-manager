import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GitLogEntry } from '../../shared/types';
import type { IGitOps } from '../interfaces/git-ops';
import { getShellEnv } from './shell-env';

const execFileAsync = promisify(execFile);

export class LocalGitOps implements IGitOps {
  constructor(private cwd: string) {}

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.cwd,
      env: getShellEnv(),
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  }

  async fetch(remote = 'origin'): Promise<void> {
    await this.git(['fetch', remote]);
  }

  async createBranch(name: string, baseBranch?: string): Promise<void> {
    const args = ['checkout', '-b', name];
    if (baseBranch) args.push(baseBranch);
    await this.git(args);
  }

  async checkout(branch: string): Promise<void> {
    await this.git(['checkout', branch]);
  }

  async push(branch: string, force?: boolean): Promise<void> {
    const args = ['push', '-u', 'origin', branch];
    if (force) args.push('--force-with-lease');
    await this.git(args);
  }

  async pull(branch: string): Promise<void> {
    await this.git(['pull', 'origin', branch]);
  }

  async diff(fromRef: string, toRef?: string): Promise<string> {
    if (toRef) {
      return this.git(['diff', `${fromRef}...${toRef}`]);
    }
    return this.git(['diff', fromRef]);
  }

  async diffStat(fromRef: string, toRef?: string): Promise<string> {
    if (toRef) {
      return this.git(['diff', '--stat', `${fromRef}...${toRef}`]);
    }
    return this.git(['diff', '--stat', fromRef]);
  }

  async commit(message: string): Promise<string> {
    await this.git(['add', '-A']);
    await this.git(['commit', '-m', message]);
    return this.git(['rev-parse', 'HEAD']);
  }

  async log(count = 10): Promise<GitLogEntry[]> {
    const output = await this.git(['log', `-${count}`, '--format=%H%n%s%n%an%n%aI']);
    if (!output) return [];

    const lines = output.split('\n');
    const entries: GitLogEntry[] = [];
    for (let i = 0; i + 3 < lines.length; i += 4) {
      entries.push({
        hash: lines[i],
        subject: lines[i + 1],
        author: lines[i + 2],
        date: lines[i + 3],
      });
    }
    return entries;
  }

  async rebase(onto: string): Promise<void> {
    await this.git(['rebase', onto]);
  }

  async rebaseAbort(): Promise<void> {
    await this.git(['rebase', '--abort']);
  }

  async getCurrentBranch(): Promise<string> {
    return this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  async clean(): Promise<void> {
    await this.git(['reset', '--hard', 'HEAD']);
    await this.git(['clean', '-fd']);
  }

  async status(): Promise<string> {
    return this.git(['status', '--porcelain']);
  }

  async resetFile(filepath: string): Promise<void> {
    await this.git(['checkout', '--', filepath]);
  }

  async showCommit(hash: string): Promise<string> {
    return this.git(['show', hash]);
  }

  async deleteRemoteBranch(branch: string): Promise<void> {
    await this.git(['push', 'origin', '--delete', branch]);
  }
}
