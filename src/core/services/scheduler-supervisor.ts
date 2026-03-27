import type { IAutomatedAgentStore } from '../interfaces/automated-agent-store';
import type { IScheduledAgentService } from '../interfaces/scheduled-agent-service';
import { getAppLogger } from './app-logger';

export class SchedulerSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private automatedAgentStore: IAutomatedAgentStore,
    private scheduledAgentService: IScheduledAgentService,
  ) {}

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    // Immediate first poll
    this.poll().catch(err => getAppLogger().logError('SchedulerSupervisor', 'initial poll error', err));
    this.timer = setInterval(
      () => this.poll().catch(err => getAppLogger().logError('SchedulerSupervisor', 'poll error', err)),
      intervalMs,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const dueAgents = await this.automatedAgentStore.listDueAgents(Date.now());
      for (const agent of dueAgents) {
        try {
          await this.scheduledAgentService.triggerRun(agent, 'scheduler');
        } catch (err) {
          // Per-agent errors are logged but don't stop processing other agents
          const msg = err instanceof Error ? err.message : String(err);
          getAppLogger().warn('SchedulerSupervisor', `Failed to trigger agent "${agent.name}": ${msg}`);
        }
      }
    } catch (err) {
      getAppLogger().logError('SchedulerSupervisor', 'poll error', err);
    }
  }
}
