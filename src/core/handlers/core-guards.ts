import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { Task, Transition, TransitionContext, GuardResult, IGuardQueryContext } from '../../shared/types';
import { hasPendingPhases, hasFollowingPhases } from '../../shared/phase-utils';

export function registerCoreGuards(engine: IPipelineEngine): void {
  engine.registerGuard('has_pr', (task: Task): GuardResult => {
    if (task.prLink) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Task must have a PR link' };
  });

  engine.registerGuard('dependencies_resolved', (task: Task, _transition: Transition, _context: TransitionContext, queryCtx: IGuardQueryContext): GuardResult => {
    const count = queryCtx.countUnresolvedDependencies(task.id);
    if (count === 0) {
      return { allowed: true };
    }
    return { allowed: false, reason: `${count} unresolved dependencies` };
  });

  engine.registerGuard('max_retries', (task: Task, transition: Transition, _context: TransitionContext, queryCtx: IGuardQueryContext, params?: Record<string, unknown>): GuardResult => {
    const max = (params?.max as number) ?? 3;

    // Extract agent type from the transition's start_agent hook so we only
    // count failures for the agent that will be retried, not globally.
    const startAgentHook = transition.hooks?.find(h => h.name === 'start_agent');
    const agentType = startAgentHook?.params?.agentType as string | undefined;

    const count = queryCtx.countFailedRuns(task.id, agentType);

    // count includes the run that just failed; first failure = count 1.
    // max: 3 means allow up to 3 retries (4 total attempts), so block when count > max.
    if (count > max) {
      return { allowed: false, reason: `Max retries (${max}) reached — ${count} failed runs for ${agentType ?? 'all agents'}` };
    }
    return { allowed: true };
  });

  engine.registerGuard('no_running_agent', (task: Task, _transition: Transition, _context: TransitionContext, queryCtx: IGuardQueryContext): GuardResult => {
    const count = queryCtx.countRunningRuns(task.id);
    if (count > 0) {
      return { allowed: false, reason: 'An agent is already running for this task' };
    }
    return { allowed: true };
  });

  engine.registerGuard('has_pending_phases', (task: Task): GuardResult => {
    if (hasPendingPhases(task.phases)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'No pending implementation phases' };
  });

  engine.registerGuard('has_following_phases', (task: Task): GuardResult => {
    if (hasFollowingPhases(task.phases)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'No following pending phases' };
  });

  engine.registerGuard('is_admin', (_task: Task, _transition: Transition, context: TransitionContext, queryCtx: IGuardQueryContext): GuardResult => {
    if (!context.actor) {
      return { allowed: false, reason: 'No actor provided - admin role required' };
    }

    const role = queryCtx.getUserRole(context.actor);

    if (!role) {
      return { allowed: false, reason: 'User not found' };
    }

    if (role !== 'admin') {
      return { allowed: false, reason: 'Only administrators can perform this action' };
    }

    return { allowed: true };
  });
}
