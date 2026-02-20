import type { CreatePRParams, PRInfo, PRStatus } from '../../shared/types';

export interface IScmPlatform {
  createPR(params: CreatePRParams): Promise<PRInfo>;
  mergePR(prUrl: string): Promise<void>;
  getPRStatus(prUrl: string): Promise<PRStatus>;
  isPRMergeable(prUrl: string): Promise<boolean>;
}
