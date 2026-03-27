import type { AutomatedAgent, AgentRun, Project } from '../../shared/types';
import type { IAutomatedAgentStore } from '../interfaces/automated-agent-store';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { IAutomatedAgentPromptBuilder } from '../interfaces/automated-agent-prompt-builder';
import type { AgentLibRegistry } from './agent-lib-registry';
import type { IAgentLib, AgentLibCallbacks } from '../interfaces/agent-lib';
import { computeNextRunAt } from './automated-agent-schedule';
import { getAppLogger } from './app-logger';

const DEFAULT_REPORT_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '2-3 sentence overview of what you found/did' },
      findings: { type: 'array', items: { type: 'string' }, description: 'Key findings, observations, or completed actions' },
      recommendations: { type: 'array', items: { type: 'string' }, description: 'Suggested next steps or improvements' },
    },
    required: ['summary', 'findings', 'recommendations'],
  },
};

import type { IScheduledAgentService } from '../interfaces/scheduled-agent-service';

export class ScheduledAgentService implements IScheduledAgentService {
  private activeRuns = new Map<string, Promise<void>>();
  /** Maps runId → lib name so stop() can target the correct lib. */
  private activeRunLibs = new Map<string, string>();

  constructor(
    private automatedAgentStore: IAutomatedAgentStore,
    private agentRunStore: IAgentRunStore,
    private projectStore: IProjectStore,
    private taskStore: ITaskStore,
    private agentLibRegistry: AgentLibRegistry,
    private notificationRouter: INotificationRouter,
    private promptBuilders: Map<string, IAutomatedAgentPromptBuilder> = new Map(),
  ) {}

  async isRunning(automatedAgentId: string): Promise<boolean> {
    if (this.activeRuns.has(automatedAgentId)) return true;
    const activeRun = await this.agentRunStore.getActiveRunForAutomatedAgent(automatedAgentId);
    return activeRun !== null;
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

    let run: AgentRun | undefined;
    try {
      const project = await this.projectStore.getProject(agent.projectId);
      if (!project) throw new Error(`Project ${agent.projectId} not found`);
      if (!project.path) throw new Error(`Project ${project.name} has no path configured`);

      run = await this.agentRunStore.createRun({
        taskId: `__auto__:${agent.id}`,
        agentType: 'automated-agent',
        mode: 'new',
        automatedAgentId: agent.id,
      });

      const { prompt, outputFormat } = await this.buildPrompt(agent, project);

      // Store prompt on run
      await this.agentRunStore.updateRun(run.id, { prompt });

      const lib = this.agentLibRegistry.getLib('claude-code');
      this.activeRunLibs.set(run.id, lib.name);
      const runPromise = this.executeInBackground(run, agent, project, prompt, outputFormat, lib, triggeredBy, onOutput, onMessage);
      runPromise.catch(err => getAppLogger().logError('ScheduledAgentService', `Unhandled error in background execution for "${agent.name}"`, err));
      this.activeRuns.set(agent.id, runPromise);

      return run;
    } catch (err) {
      this.activeRuns.delete(agent.id);
      // If run was created, mark it as failed in DB
      if (run) {
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          error: `Setup failed: ${err instanceof Error ? err.message : String(err)}`,
          completedAt: Date.now(),
        }).catch((updateErr) => getAppLogger().logError('ScheduledAgentService', `Failed to mark run ${run!.id} as failed after setup error`, updateErr));
      }
      throw err;
    }
  }

  private async buildPrompt(agent: AutomatedAgent, project: Project): Promise<{ prompt: string; outputFormat?: object }> {
    const sections: string[] = [];

    sections.push(`# Automated Agent: ${agent.name}`);
    sections.push(`Project: ${project.name}`);
    sections.push(`Project path: ${project.path}`);
    sections.push('');

    // Task context — use custom builder if registered for this template, otherwise default listing
    const customBuilder = agent.templateId
      ? this.promptBuilders.get(agent.templateId)
      : undefined;
    if (customBuilder) {
      try {
        const customContext = await customBuilder.buildContext(agent, project);
        sections.push(customContext);
        sections.push('');
      } catch (err) {
        getAppLogger().logError('ScheduledAgentService', `Custom prompt builder for "${agent.templateId}" failed`, err);
        throw new Error(`Prompt builder for template "${agent.templateId}" failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }
    } else {
      await this.appendDefaultTaskContext(sections, project);
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
    sections.push('');

    // Output format — custom builder may provide a JSON schema, otherwise use default report schema
    const outputFormat = customBuilder?.getOutputFormat?.() ?? DEFAULT_REPORT_OUTPUT_FORMAT;

    // Tell the agent about the expected output structure
    sections.push('## Output Format');
    sections.push('');
    sections.push('Your final response MUST be valid JSON matching the required schema. The system will parse it automatically.');

    return { prompt: sections.join('\n'), outputFormat };
  }

  private async appendDefaultTaskContext(sections: string[], project: Project): Promise<void> {
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
  }

  private async executeInBackground(
    run: AgentRun,
    agent: AutomatedAgent,
    project: Project,
    prompt: string,
    outputFormat: object | undefined,
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
        outputFormat,
      }, callbacks);

      const telemetry = lib.getTelemetry(run.id);
      const status = result.exitCode === 0 ? 'completed' : 'failed';

      await this.agentRunStore.updateRun(run.id, {
        status,
        output: result.output,
        exitCode: result.exitCode,
        completedAt: Date.now(),
        error: result.error,
        costInputTokens: result.costInputTokens,
        costOutputTokens: result.costOutputTokens,
        messageCount: telemetry?.messageCount,
        payload: result.structuredOutput ?? undefined,
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
      this.activeRunLibs.delete(run.id);
      this.activeRuns.delete(agent.id);
    }
  }

  async stop(runId: string): Promise<void> {
    const libName = this.activeRunLibs.get(runId);
    if (!libName) {
      // Run not tracked — already completed or unknown
      getAppLogger().warn('ScheduledAgentService', `stop() called for run ${runId} which is not active — ignoring`);
      return;
    }

    const lib = this.agentLibRegistry.getLib(libName);
    await lib.stop(runId);

    this.activeRunLibs.delete(runId);

    await this.agentRunStore.updateRun(runId, {
      status: 'cancelled',
      completedAt: Date.now(),
    });
  }
}
