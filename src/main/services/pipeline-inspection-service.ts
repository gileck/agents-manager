import type {
  TransitionResult,
  PipelineDiagnostics,
  HookRetryResult,
  HookFailureRecord,
  Transition,
} from '../../shared/types';
import { getActivePhaseIndex } from '../../shared/phase-utils';
import type { ITaskStore } from '../interfaces/task-store';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IActivityLog } from '../interfaces/activity-log';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IPipelineInspectionService } from '../interfaces/pipeline-inspection-service';

/** Grace period after an agent completes before declaring a task "stuck". */
const AGENT_FINALIZATION_GRACE_MS = 30_000;

export class PipelineInspectionService implements IPipelineInspectionService {
  constructor(
    private taskStore: ITaskStore,
    private pipelineEngine: IPipelineEngine,
    private pipelineStore: IPipelineStore,
    private taskEventLog: ITaskEventLog,
    private activityLog: IActivityLog,
    private agentRunStore: IAgentRunStore,
  ) {}

  async getPipelineDiagnostics(taskId: string): Promise<PipelineDiagnostics | null> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return null;

    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return null;

    const currentStatusDef = pipeline.statuses.find((s) => s.name === task.status);

    // Run independent queries in parallel
    const [allTransitions, recentEvents, agentRuns] = await Promise.all([
      this.pipelineEngine.getAllTransitions(task),
      this.taskEventLog.getEvents({
        taskId,
        since: Date.now() - 86400000, // last 24 hours
      }),
      this.agentRunStore.getRunsForTask(taskId),
    ]);

    // Pre-check guards for manual transitions
    for (const t of allTransitions.manual) {
      t.guardStatus = await this.pipelineEngine.checkGuards(task, t.to, 'manual') ?? undefined;
    }

    const hookFailures: HookFailureRecord[] = recentEvents
      .filter((e) => e.category === 'system' && (e.severity === 'error' || e.severity === 'warning')
        && e.data?.hook && typeof e.data.hook === 'string')
      .map((e) => {
        const retryableHooks = ['merge_pr', 'push_and_create_pr', 'advance_phase', 'delete_worktree'];
        return {
          id: e.id,
          taskId: e.taskId,
          hookName: e.data.hook as string,
          error: (e.data.error as string) ?? e.message,
          policy: (e.data.policy as HookFailureRecord['policy']) ?? 'best_effort',
          transitionFrom: (e.data.fromStatus as string) ?? '',
          transitionTo: (e.data.toStatus as string) ?? '',
          timestamp: e.createdAt,
          retryable: retryableHooks.includes(e.data.hook as string),
        };
      });

    // Agent state
    const latestRun = agentRuns[0] ?? null;
    const failedRuns = agentRuns.filter((r) => r.status === 'failed' || r.status === 'cancelled');
    const hasRunningAgent = agentRuns.some((r) => r.status === 'running');

    // Stuck detection
    const isAgentPhase = currentStatusDef?.category === 'agent_running';
    let isStuck = false;
    let stuckReason: string | undefined;

    if (isAgentPhase && !hasRunningAgent) {
      // Agent phase but no agent running
      const isFinalizing = latestRun?.status === 'completed' && latestRun.completedAt != null
        && (Date.now() - latestRun.completedAt) < AGENT_FINALIZATION_GRACE_MS;
      if (!isFinalizing) {
        isStuck = true;
        if (latestRun?.status === 'failed') {
          stuckReason = `Agent failed: ${latestRun.error ?? 'unknown error'}`;
        } else {
          stuckReason = 'Agent phase but no agent is running';
        }
      }
    }

    // Check for done + pending phases with failed advance_phase
    if (currentStatusDef?.category === 'terminal' && task.phases) {
      const pendingPhases = task.phases.filter((p) => p.status === 'pending');
      if (pendingPhases.length > 0) {
        const advanceFailure = hookFailures.find((f) => f.hookName === 'advance_phase');
        if (advanceFailure) {
          isStuck = true;
          stuckReason = `Phase advance failed: ${advanceFailure.error}`;
        }
      }
    }

    return {
      taskId,
      currentStatus: task.status,
      statusMeta: {
        label: currentStatusDef?.label ?? task.status,
        category: currentStatusDef?.category,
        isFinal: currentStatusDef?.isFinal,
        color: currentStatusDef?.color,
      },
      allTransitions,
      recentHookFailures: hookFailures,
      phases: task.phases,
      activePhaseIndex: getActivePhaseIndex(task.phases),
      agentState: {
        hasRunningAgent,
        lastRunStatus: latestRun?.status ?? null,
        lastRunError: latestRun?.error ?? null,
        totalFailedRuns: failedRuns.length,
      },
      isStuck,
      stuckReason,
    };
  }

  async retryHook(taskId: string, hookName: string, transitionFrom?: string, transitionTo?: string): Promise<HookRetryResult> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return { success: false, hookName, error: `Task not found: ${taskId}` };

    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return { success: false, hookName, error: `Pipeline not found: ${task.pipelineId}` };

    // Find the transition that would have this hook
    let transition: Transition | undefined;
    if (transitionFrom && transitionTo) {
      transition = pipeline.transitions.find(
        (t) => (t.from === transitionFrom || t.from === '*') && t.to === transitionTo
          && t.hooks?.some((h) => h.name === hookName),
      );
    }
    if (!transition) {
      // Fallback: search all transitions for this hook
      transition = pipeline.transitions.find(
        (t) => t.hooks?.some((h) => h.name === hookName),
      );
    }
    if (!transition) {
      return { success: false, hookName, error: `No transition found with hook "${hookName}"` };
    }

    const result = await this.pipelineEngine.retryHook(task, hookName, transition, {
      trigger: 'manual',
      data: { retry: true },
    });

    if (result.success) {
      await this.activityLog.log({
        action: 'system',
        entityType: 'task',
        entityId: taskId,
        summary: `Retried hook "${hookName}" successfully`,
        data: { hookName },
      });
    }

    return result;
  }

  async advancePhase(taskId: string): Promise<TransitionResult> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };

    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return { success: false, error: `Pipeline not found: ${task.pipelineId}` };

    // Single search: find a system transition from the current status with an advance_phase hook
    const matchingTransition = pipeline.transitions.find(
      (t) => (t.from === task.status || t.from === '*')
        && t.trigger === 'system'
        && t.hooks?.some((h) => h.name === 'advance_phase'),
    );

    if (!matchingTransition) {
      await this.taskEventLog.log({
        taskId,
        category: 'system',
        severity: 'warning',
        message: `No system transition from "${task.status}" with advance_phase hook in pipeline "${task.pipelineId}"`,
        data: { pipelineId: task.pipelineId, currentStatus: task.status },
      });
      return { success: false, error: `No system transition from "${task.status}" with advance_phase hook` };
    }

    const result = await this.pipelineEngine.executeTransition(task, matchingTransition.to, {
      trigger: 'system',
      data: { reason: 'manual_advance_phase' },
    });

    if (result.success) {
      await this.activityLog.log({
        action: 'transition',
        entityType: 'task',
        entityId: taskId,
        summary: `Manually advanced phase for task`,
        data: { fromStatus: task.status, toStatus: matchingTransition.to },
      });
    }

    return result;
  }
}
