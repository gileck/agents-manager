import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IAgentService } from '../interfaces/agent-service';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { ITaskStore } from '../interfaces/task-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { IPipelineInspectionService } from '../interfaces/pipeline-inspection-service';
import type { AgentChatMessage } from '../../shared/types';
import { now } from '../stores/utils';
import { getAppLogger } from './app-logger';

/** Grace period added on top of the per-run timeout to avoid racing with the SDK-level abort. */
const GRACE_PERIOD_MS = 5 * 60 * 1000;

/** Grace period before declaring a task stalled (allows inline retry + follow-up to complete). */
const STALL_GRACE_MS = 60_000;

/** Maximum number of supervisor-initiated recovery attempts per task. */
const MAX_STALL_RECOVERY_ATTEMPTS = 2;

export class AgentSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Tracks recovery attempts per task to enforce MAX_STALL_RECOVERY_ATTEMPTS. */
  private recoveryAttempts = new Map<string, number>();

  constructor(
    private agentRunStore: IAgentRunStore,
    private agentService: IAgentService,
    private taskEventLog: ITaskEventLog,
    private pollIntervalMs = 30_000,
    /** Fallback timeout when the run has no per-run timeoutMs stored in the DB. */
    private defaultTimeoutMs = 35 * 60 * 1000,
    /** Optional deps for stall detection — when absent, stall sweep is skipped. */
    private taskStore?: ITaskStore,
    private pipelineStore?: IPipelineStore,
    private pipelineInspectionService?: IPipelineInspectionService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll().catch(err => getAppLogger().logError('AgentSupervisor', 'poll error', err)), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    const activeRuns = await this.agentRunStore.getActiveRuns();

    if (activeRuns.length > 0) {
      const activeRunIds = new Set(this.agentService.getActiveRunIds());

      for (const run of activeRuns) {
        // Ghost run: in DB as running but not tracked in memory
        if (!activeRunIds.has(run.id)) {
          const completedAt = now();
          const elapsedMs = completedAt - run.startedAt;
          const elapsedSec = Math.round(elapsedMs / 1000);

          const statusMsg: AgentChatMessage = { type: 'status', status: 'failed', message: 'Detected as ghost run by supervisor', timestamp: completedAt };
          const updatedMessages = [...(run.messages ?? []), statusMsg];
          await this.agentRunStore.updateRun(run.id, {
            status: 'failed',
            outcome: 'interrupted',
            completedAt,
            output: (run.output ?? '') + '\n[Detected as ghost run by supervisor]',
            messages: updatedMessages,
          });

          await this.taskEventLog.log({
            taskId: run.taskId,
            category: 'agent',
            severity: 'warning',
            message: `Ghost run detected and marked failed: ${run.id} (${run.agentType}/${run.mode}, running for ${elapsedSec}s, ${activeRunIds.size} active in memory)`,
            data: {
              agentRunId: run.id,
              agentType: run.agentType,
              mode: run.mode,
              elapsedMs,
              startedAt: run.startedAt,
              activeInMemoryCount: activeRunIds.size,
              activeInMemoryIds: Array.from(activeRunIds),
            },
          });
          continue;
        }

        // Timed-out run: use per-run timeoutMs (set by telemetry flush) with grace period,
        // falling back to the default timeout when the run has no stored timeout.
        const elapsed = now() - run.startedAt;
        const effectiveTimeout = (run.timeoutMs ?? this.defaultTimeoutMs) + GRACE_PERIOD_MS;
        if (elapsed > effectiveTimeout) {
          try {
            await this.agentService.stop(run.id);
          } catch {
            // Agent may have already completed
          }

          const timedOutAt = now();
          const timeoutMsg: AgentChatMessage = { type: 'status', status: 'timed_out', message: 'Timed out by supervisor', timestamp: timedOutAt };
          const timedOutMessages = [...(run.messages ?? []), timeoutMsg];
          await this.agentRunStore.updateRun(run.id, {
            status: 'timed_out',
            completedAt: timedOutAt,
            output: (run.output ?? '') + '\n[Timed out by supervisor]',
            messages: timedOutMessages,
          });

          await this.taskEventLog.log({
            taskId: run.taskId,
            category: 'agent',
            severity: 'warning',
            message: `Agent run timed out after ${Math.round(elapsed / 1000)}s: ${run.id}`,
            data: { agentRunId: run.id, elapsed },
          });
        }
      }
    }

    // Layer 2: Detect tasks stuck in agent_running statuses with no running agent
    await this.detectStalledTasks();
  }

  /**
   * Scans tasks in `agent_running` statuses that have no running agent and no
   * recently completed agent, then retries the `start_agent` hook (capped).
   */
  private async detectStalledTasks(): Promise<void> {
    if (!this.taskStore || !this.pipelineStore || !this.pipelineInspectionService) return;

    const pipelines = await this.pipelineStore.listPipelines();

    // Build a set of status names whose category is 'agent_running', keyed by pipelineId
    const agentRunningStatuses = new Map<string, Set<string>>();
    for (const pipeline of pipelines) {
      const statusNames = new Set<string>();
      for (const s of pipeline.statuses) {
        if (s.category === 'agent_running') statusNames.add(s.name);
      }
      if (statusNames.size > 0) agentRunningStatuses.set(pipeline.id, statusNames);
    }
    if (agentRunningStatuses.size === 0) return;

    const currentTime = now();

    for (const [pipelineId, statusNames] of agentRunningStatuses) {
      for (const status of statusNames) {
        const tasks = await this.taskStore.listTasks({ pipelineId, status });

        for (const task of tasks) {
          // Check if there's already a running agent for this task
          const runs = await this.agentRunStore.getRunsForTask(task.id);
          const hasRunning = runs.some(r => r.status === 'running');
          if (hasRunning) continue;

          // Grace period: skip if an agent completed recently (may be finalizing transition)
          const latestCompleted = runs.find(r => r.completedAt != null);
          if (latestCompleted?.completedAt && (currentTime - latestCompleted.completedAt) < STALL_GRACE_MS) {
            continue;
          }

          // Grace period: skip if task was updated very recently (may have just entered this status)
          if (task.updatedAt && (currentTime - task.updatedAt) < STALL_GRACE_MS) {
            continue;
          }

          // Check recovery cap
          const attempts = this.recoveryAttempts.get(task.id) ?? 0;
          if (attempts >= MAX_STALL_RECOVERY_ATTEMPTS) continue;

          // Attempt recovery
          this.recoveryAttempts.set(task.id, attempts + 1);

          await this.taskEventLog.log({
            taskId: task.id,
            category: 'system',
            severity: 'warning',
            message: `Stall detected: task ${task.id} in "${status}" with no running agent — retrying start_agent (attempt ${attempts + 1}/${MAX_STALL_RECOVERY_ATTEMPTS})`,
            data: { status, recoveryAttempt: attempts + 1, maxAttempts: MAX_STALL_RECOVERY_ATTEMPTS },
          });

          try {
            const result = await this.pipelineInspectionService.retryHook(task.id, 'start_agent');
            if (!result.success) {
              await this.taskEventLog.log({
                taskId: task.id,
                category: 'system',
                severity: 'error',
                message: `Stall recovery retryHook failed for task ${task.id}: ${result.error}`,
                data: { error: result.error, recoveryAttempt: attempts + 1 },
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
              await this.taskEventLog.log({
                taskId: task.id,
                category: 'system',
                severity: 'error',
                message: `Stall recovery threw for task ${task.id}: ${msg}`,
                data: { error: msg, recoveryAttempt: attempts + 1 },
              });
            } catch { /* db may be closed */ }
          }
        }
      }
    }
  }
}
