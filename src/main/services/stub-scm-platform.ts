import type { CreatePRParams, PRInfo, PRStatus } from '../../shared/types';
import type { IScmPlatform } from '../interfaces/scm-platform';

export class StubScmPlatform implements IScmPlatform {
  private prCounter = 0;
  private prStatuses = new Map<string, PRStatus>();

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

  async mergePR(prUrl: string): Promise<void> {
    this.prStatuses.set(prUrl, 'merged');
  }

  async getPRStatus(prUrl: string): Promise<PRStatus> {
    return this.prStatuses.get(prUrl) ?? 'open';
  }
}
