import type { AutomatedAgent, AgentRun, Project } from '../../shared/types';
import type { IAutomatedAgentStore } from '../interfaces/automated-agent-store';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { AgentLibRegistry } from './agent-lib-registry';
import type { IAgentLib, AgentLibCallbacks } from '../interfaces/agent-lib';
import { computeNextRunAt } from './automated-agent-schedule';
import { getAppLogger } from './app-logger';

export class ScheduledAgentService {
  private activeRuns = new Map<string, Promise<void>>();
  private activeRunIds = new Set<string>();

  constructor(
    private automatedAgentStore: IAutomatedAgentStore,
    private agentRunStore: IAgentRunStore,
    private projectStore: IProjectStore,
    private taskStore: ITaskStore,
    private agentLibRegistry: AgentLibRegistry,
    private notificationRouter: INotificationRouter,
  ) {}

  async isRunning(automatedAgentId: string): Promise<boolean> {
    if (this.activeRuns.has(automatedAgentId)) return true;
    const activeRun = await this.agentRunStore.getActiveRunForAutomatedAgent(automatedAgentId);
    return activeRun !== null;
  }

  getActiveRunIds(): string[] {
    return Array.from(this.activeRunIds);
  }

  async triggerRun(
    agent: AutomatedAgent,
    triggeredBy: 'scheduler' | 'manual',
    onOutput?: (chunk: string) => void,
    onMessage?: AgentLibCallbacks['onMessage'],
  ): Promise<AgentRun> {
    if (await this.isRunning(agent.id)) {
      throw new Error(`Automated agent "${agent.name}" is already running`);
    }

    // Claim the slot synchronously to prevent TOCTOU race between isRunning and executeInBackground
    this.activeRuns.set(agent.id, Promise.resolve());

    try {
      const project = await this.projectStore.getProject(agent.projectId);
      if (!project) throw new Error(`Project ${agent.projectId} not found`);
      if (!project.path) throw new Error(`Project ${project.name} has no path configured`);

      const run = await this.agentRunStore.createRun({
        taskId: `__auto__:${agent.id}`,
        agentType: 'automated-agent',
        mode: 'new',
        automatedAgentId: agent.id,
      });

      const prompt = await this.buildPrompt(agent, project);

      // Store prompt on run
      await this.agentRunStore.updateRun(run.id, { prompt });

      const lib = this.agentLibRegistry.getLib('claude-code');
      this.activeRunIds.add(run.id);
      const runPromise = this.executeInBackground(run, agent, project, prompt, lib, triggeredBy, onOutput, onMessage);
      runPromise.catch(err => getAppLogger().logError('ScheduledAgentService', `Unhandled error in background execution for "${agent.name}"`, err));
      this.activeRuns.set(agent.id, runPromise);

      return run;
    } catch (err) {
      this.activeRuns.delete(agent.id);
      throw err;
    }
  }

  private async buildPrompt(agent: AutomatedAgent, project: Project): Promise<string> {
    const sections: string[] = [];

    sections.push(`# Automated Agent: ${agent.name}`);
    sections.push(`Project: ${project.name}`);
    sections.push(`Project path: ${project.path}`);
    sections.push('');

    // Task summary
    try {
      const tasks = await this.taskStore.listTasks({ projectId: project.id });
      const byStatus: Record<string, number> = {};
      for (const t of tasks) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      }
      sections.push('## Current Tasks Summary');
      sections.push(`Total tasks: ${tasks.length}`);
      for (const [status, count] of Object.entries(byStatus)) {
        sections.push(`- ${status}: ${count}`);
      }
      sections.push('');

      // Top 50 open tasks
      const openTasks = tasks.filter(t => !['done', 'completed', 'cancelled'].includes(t.status)).slice(0, 50);
      if (openTasks.length > 0) {
        sections.push('## Open Tasks');
        for (const t of openTasks) {
          sections.push(`- [${t.id}] ${t.title} (status: ${t.status}, priority: ${t.priority})`);
        }
        sections.push('');
      }
    } catch (err) {
      getAppLogger().warn('ScheduledAgentService', 'Failed to load tasks for prompt', { error: err instanceof Error ? err.message : String(err) });
      sections.push('## Tasks: Unable to load task summary');
      sections.push('');
    }

    // Capabilities
    sections.push('## Your Capabilities');
    const caps = agent.capabilities;
    sections.push(`- Create tasks: ${caps.canCreateTasks ? 'YES' : 'NO'}`);
    sections.push(`- Modify tasks: ${caps.canModifyTasks ? 'YES' : 'NO'}`);
    sections.push(`- Read only mode: ${caps.readOnly ? 'YES' : 'NO'}`);
    sections.push(`- Max actions: ${caps.maxActions}`);
    if (caps.dryRun) sections.push('- DRY RUN MODE: Do not make actual changes, only report what you would do.');
    sections.push('');

    // Agent instructions
    sections.push('## Instructions');
    sections.push(agent.promptInstructions);

    return sections.join('\n');
  }

  private async executeInBackground(
    run: AgentRun,
    agent: AutomatedAgent,
    project: Project,
    prompt: string,
    lib: IAgentLib,
    triggeredBy: 'scheduler' | 'manual',
    onOutput?: (chunk: string) => void,
    onMessage?: AgentLibCallbacks['onMessage'],
  ): Promise<void> {
    try {
      getAppLogger().info('ScheduledAgentService', `Starting automated agent "${agent.name}" (${triggeredBy})`, { agentId: agent.id, runId: run.id });

      const callbacks: AgentLibCallbacks = {
        onOutput,
        onMessage,
        onLog: (message, data) => getAppLogger().info('ScheduledAgentService', message, data),
      };

      const result = await lib.execute(run.id, {
        prompt,
        cwd: project.path!,
        maxTurns: 50,
        timeoutMs: agent.maxRunDurationMs,
        readOnly: agent.capabilities.readOnly,
        allowedPaths: [project.path!],
        readOnlyPaths: agent.capabilities.readOnly ? [project.path!] : [],
      }, callbacks);

      const telemetry = lib.getTelemetry(run.id);
      const status = result.exitCode === 0 ? 'completed' : 'failed';

      await this.agentRunStore.updateRun(run.id, {
        status,
        output: result.output,
        exitCode: result.exitCode,
        completedAt: Date.now(),
        error: result.error,
        costInputTokens: result.costInputTokens ?? telemetry?.accumulatedInputTokens,
        costOutputTokens: result.costOutputTokens ?? telemetry?.accumulatedOutputTokens,
        messageCount: telemetry?.messageCount,
      });

      const nextRunAt = computeNextRunAt(agent.schedule, Date.now());
      await this.automatedAgentStore.recordRun(agent.id, Date.now(), status, nextRunAt);

      // Notify
      try {
        await this.notificationRouter.send({
          taskId: `__auto__:${agent.id}`,
          title: `Automated Agent: ${agent.name}`,
          body: `Run ${status} (${triggeredBy})`,
          channel: 'automated-agent',
        });
      } catch (notifyErr) {
        getAppLogger().warn('ScheduledAgentService', 'Notification send failed (non-critical)', { error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr) });
      }

      getAppLogger().info('ScheduledAgentService', `Automated agent "${agent.name}" ${status}`, { agentId: agent.id, runId: run.id });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      getAppLogger().logError('ScheduledAgentService', `Automated agent "${agent.name}" failed`, err);

      try {
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          error: errorMsg,
          completedAt: Date.now(),
        });

        const nextRunAt = computeNextRunAt(agent.schedule, Date.now());
        await this.automatedAgentStore.recordRun(agent.id, Date.now(), 'failed', nextRunAt);
      } catch (cleanupErr) {
        getAppLogger().logError('ScheduledAgentService', `Failed to record failure for agent "${agent.name}"`, cleanupErr);
      }
    } finally {
      this.activeRunIds.delete(run.id);
      this.activeRuns.delete(agent.id);
    }
  }
}
