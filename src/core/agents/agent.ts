import type { AgentContext, AgentConfig, AgentRunResult, AgentChatMessage } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';
import type { IAgentLib, AgentLibTelemetry } from '../interfaces/agent-lib';
import type { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import type { AgentLibRegistry } from '../services/agent-lib-registry';
import { getAppLogger } from '../services/app-logger';

export class Agent implements IAgent {
  readonly type: string;

  constructor(
    type: string,
    private promptBuilder: BaseAgentPromptBuilder,
    private libRegistry: AgentLibRegistry,
    private defaultEngine: string = 'claude-code',
  ) {
    this.type = type;
  }

  // Track active libs and telemetry per runId
  private activeLibs = new Map<string, IAgentLib>();
  private lastTelemetries = new Map<string, AgentLibTelemetry>();
  private telemetryIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private latestRunId: string | null = null;

  // Telemetry properties read by AgentService flush interval (reads from latest run)
  private get latestTelemetry(): AgentLibTelemetry | undefined {
    return this.latestRunId ? this.lastTelemetries.get(this.latestRunId) : undefined;
  }
  get accumulatedInputTokens(): number {
    return this.latestTelemetry?.accumulatedInputTokens ?? 0;
  }
  get accumulatedOutputTokens(): number {
    return this.latestTelemetry?.accumulatedOutputTokens ?? 0;
  }
  get lastMessageCount(): number {
    return this.latestTelemetry?.messageCount ?? 0;
  }
  get lastTimeout(): number | undefined {
    return this.latestTelemetry?.timeout;
  }
  get lastMaxTurns(): number | undefined {
    return this.latestTelemetry?.maxTurns;
  }

  async execute(
    context: AgentContext,
    config: AgentConfig,
    onOutput?: (chunk: string) => void,
    onLog?: (message: string, data?: Record<string, unknown>) => void,
    onPromptBuilt?: (prompt: string) => void,
    onMessage?: (msg: AgentChatMessage) => void,
  ): Promise<AgentRunResult> {
    const execConfig = this.promptBuilder.buildExecutionConfig(context, config);
    onPromptBuilt?.(execConfig.prompt);

    const runId = context.task.id;

    // Resolve lib from registry using config.engine (default to 'claude-code')
    const lib = this.libRegistry.getLib(config.engine ?? 'claude-code');
    this.activeLibs.set(runId, lib);
    this.latestRunId = runId;

    // Poll telemetry from lib so properties stay up to date (per-runId)
    const interval = setInterval(() => {
      const t = lib.getTelemetry(runId);
      if (t) this.lastTelemetries.set(runId, t);
    }, 500);
    this.telemetryIntervals.set(runId, interval);

    const allowedPaths = [context.workdir];
    const readOnlyPaths = execConfig.readOnly && context.project?.path ? [context.project.path] : [];

    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);
    log(`Starting agent run: mode=${context.mode}, workdir=${context.workdir}, timeout=${execConfig.timeoutMs}ms, model=${config.model ?? 'default'}`);

    try {
      const libResult = await lib.execute(runId, {
        prompt: execConfig.prompt,
        cwd: context.workdir,
        model: config.model,
        maxTurns: execConfig.maxTurns,
        timeoutMs: execConfig.timeoutMs,
        outputFormat: execConfig.outputFormat,
        allowedPaths,
        readOnlyPaths,
        readOnly: execConfig.readOnly,
      }, {
        onOutput,
        onLog,
        onMessage,
      });

      // Final telemetry snapshot
      const finalTelemetry = lib.getTelemetry(runId);
      if (finalTelemetry) this.lastTelemetries.set(runId, finalTelemetry);

      const outcome = this.promptBuilder.inferOutcome(context.mode, libResult.exitCode, libResult.output);
      log(`Agent returning: exitCode=${libResult.exitCode}, outcome=${outcome}, outputLength=${libResult.output.length}`);

      return this.promptBuilder.buildResult(context, libResult, outcome, execConfig.prompt);
    } finally {
      // Take final telemetry snapshot before cleanup so callers can still read it
      const finalT = lib.getTelemetry(runId);
      if (finalT) this.lastTelemetries.set(runId, finalT);

      const iv = this.telemetryIntervals.get(runId);
      if (iv) clearInterval(iv);
      this.telemetryIntervals.delete(runId);
      this.activeLibs.delete(runId);

      // Delayed telemetry cleanup — gives AgentService crash handler time to read token counts
      setTimeout(() => this.lastTelemetries.delete(runId), 5000);
    }
  }

  async stop(runId: string): Promise<void> {
    const iv = this.telemetryIntervals.get(runId);
    if (iv) clearInterval(iv);
    this.telemetryIntervals.delete(runId);
    this.lastTelemetries.delete(runId);
    const lib = this.activeLibs.get(runId);
    if (lib) {
      this.activeLibs.delete(runId);
      await lib.stop(runId);
    } else {
      getAppLogger().warn('Agent', `stop called for unknown runId: ${runId}`, { agentType: this.type });
    }
  }

  async isAvailable(): Promise<boolean> {
    // Delegate to the configured default engine, not hardcoded 'claude-code'
    const lib = this.libRegistry.getLib(this.defaultEngine);
    try {
      return await lib.isAvailable();
    } catch {
      return false;
    }
  }
}
