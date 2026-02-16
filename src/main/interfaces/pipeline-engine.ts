import type { Task, Transition, TransitionTrigger, TransitionContext, TransitionResult, GuardFn, HookFn } from '../../shared/types';

export interface IPipelineEngine {
  getValidTransitions(task: Task, trigger?: TransitionTrigger): Transition[];
  executeTransition(task: Task, toStatus: string, context?: TransitionContext): TransitionResult;
  registerGuard(name: string, fn: GuardFn): void;
  registerHook(name: string, fn: HookFn): void;
}
