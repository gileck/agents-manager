import type { AgentContext, AgentConfig, AgentRunResult, AgentChatMessage } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';
import type { IAgentLib, AgentLibTelemetry, AgentLibResult } from '../interfaces/agent-lib';
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
  get accumulatedCacheReadInputTokens(): number {
    return this.latestTelemetry?.accumulatedCacheReadInputTokens ?? 0;
  }
  get accumulatedCacheCreationInputTokens(): number {
    return this.latestTelemetry?.accumulatedCacheCreationInputTokens ?? 0;
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

    // For crash recovery resume with native-resume engines, use a short continuation
    // prompt instead of the full system prompt (the prior conversation is replayed by the SDK).
    let effectivePrompt = execConfig.prompt;
    if (context.resumedFromRunId && context.resumeSession && lib.supportedFeatures().nativeResume) {
      effectivePrompt = context.customPrompt?.trim() || 'You were interrupted by an app shutdown. Continue where you left off and complete the task.';
      log(`Resuming interrupted session — using continuation prompt`, { resumedFromRunId: context.resumedFromRunId, promptLength: effectivePrompt.length });
      // Update stored prompt to reflect what was actually sent (not the full system prompt)
      onPromptBuilt?.(effectivePrompt);
    }

    try {
      let libResult = await lib.execute(runId, {
        prompt: effectivePrompt,
        cwd: context.workdir,
        model: config.model,
        maxTurns: execConfig.maxTurns,
        timeoutMs: execConfig.timeoutMs,
        outputFormat: execConfig.outputFormat,
        allowedPaths,
        readOnlyPaths,
        readOnly: execConfig.readOnly,
        sessionId: context.sessionId,
        resumeSession: context.resumeSession ?? false,
        taskId: context.task.id,
        agentType: this.type,
      }, {
        onOutput,
        onLog,
        onMessage,
      });

      // Fallback: if session resume failed immediately (missing/corrupt session file),
      // retry with the full prompt and no session resume instead of failing the run.
      if (context.resumeSession && this.isSessionResumeFailure(libResult)) {
        log('Session resume failed — retrying with full prompt (no session resume)', {
          sessionId: context.sessionId,
          exitCode: libResult.exitCode,
          error: libResult.error?.slice(0, 300),
          resumedFromRunId: context.resumedFromRunId,
        });
        onOutput?.(`\n[Session resume failed for session "${context.sessionId}" (exit code ${libResult.exitCode}) — retrying with full prompt]\n`);

        libResult = await lib.execute(runId, {
          prompt: execConfig.prompt,
          cwd: context.workdir,
          model: config.model,
          maxTurns: execConfig.maxTurns,
          timeoutMs: execConfig.timeoutMs,
          outputFormat: execConfig.outputFormat,
          allowedPaths,
          readOnlyPaths,
          readOnly: execConfig.readOnly,
          sessionId: context.sessionId,
          resumeSession: false,
          taskId: context.task.id,
          agentType: this.type,
        }, {
          onOutput,
          onLog,
          onMessage,
        });
      }

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

  /**
   * Detect immediate session resume failure: process exited with an error,
   * consumed no tokens, and the error mentions "session". This typically
   * means the session file is missing or corrupt on disk.
   *
   * Note: we do NOT check `output.length === 0` because when the lib catches
   * an SDK error, the error message is placed in the `output` field as a
   * fallback (output = resultText || errorMessage). We also require the error
   * to mention "session" to avoid false-positive retries on unrelated failures
   * (bad API key, network errors, invalid model, etc.).
   *
   * ClaudeCodeLib prefixes session resume errors with "Session resume failed"
   * so this check reliably matches those cases.
   */
  private isSessionResumeFailure(result: AgentLibResult): boolean {
    return (
      result.exitCode !== 0 &&
      !result.killReason &&
      !result.costInputTokens &&
      !result.costOutputTokens &&
      (result.error?.toLowerCase().includes('session') ?? false)
    );
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
