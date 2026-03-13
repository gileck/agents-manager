import type { Task, Transition, TransitionTrigger, TransitionContext, TransitionResult, GuardFn, HookFn, AllTransitionsResult, GuardCheckResult, HookRetryResult, PostProcessingLogCategory } from '../../shared/types';

type OnPostLog = (category: PostProcessingLogCategory, message: string, details?: Record<string, unknown>, durationMs?: number) => void;

export interface IPipelineEngine {
  getValidTransitions(task: Task, trigger?: TransitionTrigger): Promise<Transition[]>;
  getAllTransitions(task: Task): Promise<AllTransitionsResult>;
  executeTransition(task: Task, toStatus: string, context?: TransitionContext, onPostLog?: OnPostLog): Promise<TransitionResult>;
  executeForceTransition(task: Task, toStatus: string, context?: TransitionContext): Promise<TransitionResult>;
  checkGuards(task: Task, toStatus: string, trigger: TransitionTrigger, outcome?: string): Promise<GuardCheckResult | null>;
  retryHook(task: Task, hookName: string, transition: Transition, context?: TransitionContext): Promise<HookRetryResult>;
  registerGuard(name: string, fn: GuardFn): void;
  registerHook(name: string, fn: HookFn): void;
}
