import type { CreatePRParams, PRInfo, PRStatus, PRChecksResult, PRStateUpper } from '../../shared/types';
import type { IScmPlatform } from '../interfaces/scm-platform';

export class StubScmPlatform implements IScmPlatform {
  private prCounter = 0;
  private prStatuses = new Map<string, PRStatus>();
  mergeableResult = true;
  onProgressCalls: string[] = [];

  setMergeable(val: boolean): void {
    this.mergeableResult = val;
  }

  async createPR(params: CreatePRParams): Promise<PRInfo> {
    this.prCounter++;
    const url = `https://github.com/stub/repo/pull/${this.prCounter}`;
    this.prStatuses.set(url, 'open');
    return {
      url,
      number: this.prCounter,
      title: params.title,
    };
  }

  async findPR(_params: { head: string; base: string }): Promise<PRInfo | null> {
    return null;
  }

  async mergePR(prUrl: string): Promise<void> {
    this.prStatuses.set(prUrl, 'merged');
  }

  async isPRMergeable(_prUrl: string, onProgress?: (message: string) => void): Promise<boolean> {
    const msg = `isPRMergeable: stub check — returning ${this.mergeableResult}`;
    if (onProgress) {
      onProgress(msg);
      this.onProgressCalls.push(msg);
    }
    return this.mergeableResult;
  }

  async getPRStatus(prUrl: string): Promise<PRStatus> {
    return this.prStatuses.get(prUrl) ?? 'open';
  }

  async getPRChecks(prUrl: string): Promise<PRChecksResult> {
    const match = prUrl.match(/\/pull\/(\d+)/);
    if (!match) throw new Error(`StubScmPlatform: Cannot extract PR number from: ${prUrl}`);
    const prNumber = parseInt(match[1], 10);
    return {
      prNumber,
      prState: (this.prStatuses.get(prUrl) ?? 'OPEN').toUpperCase() as PRStateUpper,
      mergeable: this.mergeableResult ? 'MERGEABLE' : 'CONFLICTING',
      mergeStateStatus: 'CLEAN',
      checks: [],
      fetchedAt: Date.now(),
    };
  }
}
