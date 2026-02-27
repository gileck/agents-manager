import type {
  TransitionResult,
  PipelineDiagnostics,
  HookRetryResult,
} from '../../shared/types';

export interface IPipelineInspectionService {
  getPipelineDiagnostics(taskId: string): Promise<PipelineDiagnostics | null>;
  retryHook(taskId: string, hookName: string, transitionFrom?: string, transitionTo?: string): Promise<HookRetryResult>;
  advancePhase(taskId: string): Promise<TransitionResult>;
}
