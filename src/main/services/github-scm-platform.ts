import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CreatePRParams, PRInfo, PRStatus } from '../../shared/types';
import type { IScmPlatform } from '../interfaces/scm-platform';
import { getShellEnv } from './shell-env';

const execFileAsync = promisify(execFile);

export class GitHubScmPlatform implements IScmPlatform {
  constructor(private repoPath: string) {}

  private async gh(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('gh', args, {
      cwd: this.repoPath,
      env: getShellEnv(),
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  }

  private extractPRNumber(url: string): number {
    const match = url.match(/\/pull\/(\d+)/);
    if (!match) throw new Error(`Cannot extract PR number from URL: ${url}`);
    return parseInt(match[1], 10);
  }

  async createPR(params: CreatePRParams): Promise<PRInfo> {
    // gh pr create outputs the PR URL to stdout
    const url = await this.gh([
      'pr', 'create',
      '--title', params.title,
      '--body', params.body,
      '--head', params.head,
      '--base', params.base,
    ]);

    const number = this.extractPRNumber(url);
    return { url, number, title: params.title };
  }

  async mergePR(prUrl: string): Promise<void> {
    const prNumber = this.extractPRNumber(prUrl);
    await this.gh(['pr', 'merge', String(prNumber), '--squash', '--delete-branch']);
  }

  async getPRStatus(prUrl: string): Promise<PRStatus> {
    const prNumber = this.extractPRNumber(prUrl);
    const output = await this.gh(['pr', 'view', String(prNumber), '--json', 'state']);
    const data = JSON.parse(output);
    const state = (data.state as string).toUpperCase();

    if (state === 'MERGED') return 'merged';
    if (state === 'CLOSED') return 'closed';
    return 'open';
  }
}
