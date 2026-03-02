import type { CreatePRParams, PRInfo, PRStatus, PRChecksResult } from '../../shared/types';

export interface IScmPlatform {
  createPR(params: CreatePRParams): Promise<PRInfo>;
  mergePR(prUrl: string): Promise<void>;
  getPRStatus(prUrl: string): Promise<PRStatus>;
  isPRMergeable(prUrl: string, onProgress?: (message: string) => void): Promise<boolean>;
  getPRChecks(prUrl: string): Promise<PRChecksResult>;
}
