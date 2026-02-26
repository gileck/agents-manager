import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IAgentService } from '../interfaces/agent-service';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { AgentChatMessage } from '../../shared/types';
import { now } from '../stores/utils';

/** Grace period added on top of the per-run timeout to avoid racing with the SDK-level abort. */
const GRACE_PERIOD_MS = 5 * 60 * 1000;

export class AgentSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private agentRunStore: IAgentRunStore,
    private agentService: IAgentService,
    private taskEventLog: ITaskEventLog,
    private pollIntervalMs = 30_000,
    /** Fallback timeout when the run has no per-run timeoutMs stored in the DB. */
    private defaultTimeoutMs = 35 * 60 * 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll().catch(console.error), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    const activeRuns = await this.agentRunStore.getActiveRuns();
    if (activeRuns.length === 0) return;

    const activeRunIds = new Set(this.agentService.getActiveRunIds());

    for (const run of activeRuns) {
      // Ghost run: in DB as running but not tracked in memory
      if (!activeRunIds.has(run.id)) {
        const completedAt = now();
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
          message: `Ghost run detected and marked failed: ${run.id}`,
          data: { agentRunId: run.id, agentType: run.agentType, mode: run.mode },
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
}
