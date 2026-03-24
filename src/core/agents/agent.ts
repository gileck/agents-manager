import { resolve } from 'path';
import { execSync } from 'child_process';
import type { AgentContext, AgentConfig, AgentRunResult, AgentChatMessage } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';
import type { IAgentLib, AgentLibTelemetry, AgentLibResult, AgentLibHooks } from '../interfaces/agent-lib';
import type { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import type { AgentLibRegistry } from '../services/agent-lib-registry';
import { getAppLogger } from '../services/app-logger';
import { getGlobalAgentReadOnlyPaths } from '../utils/user-paths';
import { loadAgentFileConfig } from './agent-file-config-loader';

/** Tools that perform file writes — used by both disallowedTools and readOnlyGuard. */
export const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/**
 * Bash command patterns that modify files or git state. Used by the read-only guard
 * to block destructive operations for read-only agents (reviewer, investigator, planner).
 */
export const DESTRUCTIVE_BASH_PATTERNS: RegExp[] = [
  /\brm\s/,                    // rm files/dirs
  /\bgit\s+commit\b/,          // git commit
  /\bgit\s+push\b/,            // git push
  /\bgit\s+merge\b/,           // git merge
  /\bgit\s+rebase\b/,          // git rebase
  /\bgit\s+reset\b/,           // git reset
  /\bgit\s+clean\b/,           // git clean
  /\bgit\s+add\b/,             // git add (staging)
  /\bgit\s+cherry-pick\b/,     // git cherry-pick
  /\bgit\s+revert\b/,          // git revert
  /\bgit\s+tag\b/,             // git tag
  /\bgit\s+branch\s+-[dD]\b/,  // git branch -d/-D (delete branch)
  /\bmkdir\b/,                 // create directories
  /\btouch\b/,                 // create files
  /\bchmod\b/,                 // change permissions
  /\bchown\b/,                 // change ownership
  /\bmv\b/,                    // move/rename files
  /\bcp\b/,                    // copy files (creates new)
  /\btee\b/,                   // tee writes to files
  /(?:^|[|;&\s])>/,            // redirect to file (overwrite)
  /(?:^|[|;&\s])>>/,           // redirect to file (append)
];

/**
 * Build a read-only guard function for use in preToolUse hooks. Returns a function that
 * blocks Write/Edit/MultiEdit/NotebookEdit tools and destructive Bash commands.
 *
 * This guard fires via preToolUse hooks (not canUseTool), so it cannot be bypassed by
 * SDK permissionMode settings. It provides defense-in-depth for read-only agents.
 */
export function buildReadOnlyGuard(): (toolName: string, toolInput: Record<string, unknown>) => { decision: 'block'; reason: string } | undefined {
  return (toolName: string, toolInput: Record<string, unknown>) => {
    // Block all write tools (defense-in-depth — already in disallowedTools)
    if (WRITE_TOOLS.includes(toolName)) {
      return { decision: 'block' as const, reason: `READ-ONLY GUARD: ${toolName} is blocked for read-only agents.` };
    }
    // Block destructive Bash commands
    if (toolName === 'Bash') {
      const command = toolInput.command as string | undefined;
      if (command) {
        for (const pattern of DESTRUCTIVE_BASH_PATTERNS) {
          if (pattern.test(command)) {
            return { decision: 'block' as const, reason: `READ-ONLY GUARD: Bash command blocked for read-only agent — contains write/destructive operation. Command: "${command.slice(0, 120)}"` };
          }
        }
      }
    }
    return undefined;
  };
}

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
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);

    // Load file-based agent config from .agents/{agentType}/ if project path is available
    let fileConfig = undefined;
    const projectPath = context.project?.path;
    if (projectPath) {
      fileConfig = loadAgentFileConfig(projectPath, this.type, context.mode, context.revisionReason, log);

      // Override engine/model from file config (applied before lib resolution below)
      if (fileConfig.config?.engine) {
        config = { ...config, engine: fileConfig.config.engine };
        log(`File config overriding engine to "${fileConfig.config.engine}"`, { agentType: this.type });
      }
      if (fileConfig.config?.model) {
        config = { ...config, model: fileConfig.config.model };
        log(`File config overriding model to "${fileConfig.config.model}"`, { agentType: this.type });
      }
    } else {
      log('No project path available, skipping file-based config loading', { agentType: this.type });
    }

    const execConfig = this.promptBuilder.buildExecutionConfig(context, config, fileConfig, log);
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
    // Include global read-only paths (screenshots, chat images) so agents can
    // read media referenced in task descriptions regardless of sandbox mode.
    readOnlyPaths.push(...getGlobalAgentReadOnlyPaths());

    // Merge disallowed tools from two sources:
    // 1. readOnly flag: all write tools are disallowed for read-only agents
    // 2. execConfig.disallowedTools: per-builder tool restrictions (e.g., planner disallows Edit but allows Write)
    const readOnlyDisallowed = execConfig.readOnly ? WRITE_TOOLS : [];
    const builderDisallowed = execConfig.disallowedTools ?? [];
    const allDisallowed = [...new Set([...readOnlyDisallowed, ...builderDisallowed])];
    const disallowedTools = allDisallowed.length > 0 ? allDisallowed : undefined;

    log(`Starting agent run: mode=${context.mode}, workdir=${context.workdir}, readOnly=${execConfig.readOnly}, timeout=${execConfig.timeoutMs}ms, model=${config.model ?? 'default'}`);

    // Build worktree guard hook: hard-block Edit/Write/Bash operations targeting the main
    // repo when the agent is working in an isolated worktree. This fires via SDK hooks
    // (separate from canUseTool/permissions) so it cannot be bypassed by permissionMode.
    const agentProjectPath = context.project?.path;
    const resolvedWorkdir = resolve(context.workdir);
    const resolvedProjectPath = agentProjectPath ? resolve(agentProjectPath) : null;
    const isWorktree = resolvedProjectPath && resolvedWorkdir !== resolvedProjectPath;

    // Worktree guard: hard-block operations targeting the main repo
    const worktreeGuard = isWorktree ? (toolName: string, toolInput: Record<string, unknown>) => {
      // Guard file-writing tools
      if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
        const filePath = (toolInput.file_path ?? toolInput.notebook_path) as string | undefined;
        if (!filePath) {
          return { decision: 'block' as const, reason: `WORKTREE GUARD: ${toolName} with no file path — blocked for safety.` };
        }
        const resolvedFile = resolve(resolvedWorkdir, filePath);
        if ((resolvedFile === resolvedProjectPath || resolvedFile.startsWith(resolvedProjectPath + '/')) && !resolvedFile.startsWith(resolvedWorkdir + '/') && resolvedFile !== resolvedWorkdir) {
          return { decision: 'block' as const, reason: `WORKTREE GUARD: Write to main repository path "${filePath}" is BLOCKED. Use a relative path (e.g., src/...) which resolves within your worktree "${context.workdir}".` };
        }
      }
      // Guard bash commands that cd or operate on the main repo
      if (toolName === 'Bash') {
        const command = toolInput.command as string | undefined;
        if (command) {
          // Check ALL cd occurrences (not just the first) to prevent chained escapes
          for (const cdMatch of command.matchAll(/\bcd\s+["']?([^\s"'|;&]+)/g)) {
            const cdTarget = resolve(resolvedWorkdir, cdMatch[1]);
            if ((cdTarget === resolvedProjectPath || cdTarget.startsWith(resolvedProjectPath + '/')) && !cdTarget.startsWith(resolvedWorkdir + '/') && cdTarget !== resolvedWorkdir) {
              return { decision: 'block' as const, reason: `WORKTREE GUARD: "cd ${cdMatch[1]}" targets main repository. Stay in your worktree "${context.workdir}".` };
            }
          }
        }
      }
      return undefined;
    } : null;

    // Write-restriction guard: when cleanupPaths is set, only allow writes to those paths
    // (e.g., planner can only write to ${workdir}/tmp/)
    const cleanupPaths = execConfig.cleanupPaths ?? [];
    // Pre-compute allowed write paths once (not per tool invocation)
    const resolvedAllowedWritePaths = cleanupPaths.map(p => resolve(resolvedWorkdir, p));
    const isWithinAllowedWritePath = (absPath: string): boolean => {
      return resolvedAllowedWritePaths.some(allowed => absPath === allowed || absPath.startsWith(allowed + '/'));
    };
    const writeRestriction = cleanupPaths.length > 0 ? (toolName: string, toolInput: Record<string, unknown>) => {
      // Block Write tool calls to paths outside the allowed write paths
      if (toolName === 'Write') {
        const filePath = toolInput.file_path as string | undefined;
        if (filePath) {
          const resolvedFile = resolve(resolvedWorkdir, filePath);
          // Only restrict paths within the workdir — paths outside are handled by SandboxGuard
          if ((resolvedFile === resolvedWorkdir || resolvedFile.startsWith(resolvedWorkdir + '/')) && !isWithinAllowedWritePath(resolvedFile)) {
            return { decision: 'block' as const, reason: `WRITE RESTRICTION: Write to "${filePath}" is blocked. Agent can only write to ${cleanupPaths.map(p => `${p}/`).join(', ')} for verification scripts.` };
          }
        }
      }

      // Best-effort: inspect Bash commands for write patterns targeting paths outside allowed write paths
      if (toolName === 'Bash') {
        const command = toolInput.command as string | undefined;
        if (command) {
          // Match common write patterns: >, >>, tee, cp, mv, mkdir, touch + their target paths
          const BASH_WRITE_REGEX = /(?:^|\s)(?:>|>>|tee|cp|mv|mkdir|touch)\s+["']?([^\s"'|;&]+)/g;
          for (const match of command.matchAll(BASH_WRITE_REGEX)) {
            const targetPath = match[1];
            const resolvedTarget = resolve(resolvedWorkdir, targetPath);
            // Only restrict paths within the workdir but outside allowed write paths
            if ((resolvedTarget === resolvedWorkdir || resolvedTarget.startsWith(resolvedWorkdir + '/')) && !isWithinAllowedWritePath(resolvedTarget)) {
              return { decision: 'block' as const, reason: `WRITE RESTRICTION: Bash write to "${targetPath}" is blocked. Agent can only write to ${cleanupPaths.map(p => `${p}/`).join(', ')} for verification scripts.` };
            }
          }
        }
      }

      return undefined;
    } : null;

    // Read-only guard: defense-in-depth enforcement for read-only agents. Blocks write
    // tools and destructive Bash commands via preToolUse hooks, which fire regardless of
    // SDK permissionMode. This closes the gap where `permissionMode: 'acceptEdits'`
    // auto-approves read-only tool calls without invoking canUseTool, meaning the
    // SandboxGuard never fires for read-only agents. The disallowedTools list already
    // removes Write/Edit/MultiEdit/NotebookEdit from the model's context, but this
    // guard acts as a backstop if the model somehow attempts them anyway.
    const readOnlyGuard = execConfig.readOnly ? buildReadOnlyGuard() : null;

    // Compose all preToolUse hooks into a single function
    const composedPreToolUse = (worktreeGuard || writeRestriction || readOnlyGuard) ? (toolName: string, toolInput: Record<string, unknown>) => {
      if (worktreeGuard) {
        const result = worktreeGuard(toolName, toolInput);
        if (result) return result;
      }
      if (writeRestriction) {
        const result = writeRestriction(toolName, toolInput);
        if (result) return result;
      }
      if (readOnlyGuard) {
        const result = readOnlyGuard(toolName, toolInput);
        if (result) return result;
      }
      return undefined;
    } : undefined;

    const composedHooks: AgentLibHooks | undefined = composedPreToolUse ? { preToolUse: composedPreToolUse } : undefined;

    // For session resumes with native-resume engines, use a short continuation prompt
    // instead of the full system prompt (the prior conversation is replayed by the SDK).
    // Two cases:
    //   1. Crash recovery: context.resumedFromRunId is set — use generic "continue" prompt
    //   2. Revision-mode: mode='revision' with session resume — inject feedback via buildContinuationPrompt()
    let effectivePrompt = execConfig.prompt;
    if (context.resumedFromRunId && context.resumeSession && lib.supportedFeatures().nativeResume) {
      // Crash recovery resume
      effectivePrompt = context.customPrompt?.trim() || 'You were interrupted by an app shutdown. Continue where you left off and complete the task.';
      log(`Resuming interrupted session — using continuation prompt`, { resumedFromRunId: context.resumedFromRunId, promptLength: effectivePrompt.length });
      // Update stored prompt to reflect what was actually sent (not the full system prompt)
      onPromptBuilt?.(effectivePrompt);
    } else if (context.resumeSession && !context.resumedFromRunId && lib.supportedFeatures().nativeResume) {
      // Revision-mode resume: the SDK will replay the prior conversation, so the full
      // system prompt is redundant. Build a short continuation prompt that injects
      // the new feedback as a user message the agent must address.
      const continuationPrompt = this.promptBuilder.buildContinuationPrompt(context);
      if (continuationPrompt) {
        effectivePrompt = continuationPrompt;
        log(`Revision-mode session resume — using continuation prompt with feedback`, {
          sessionId: context.sessionId,
          revisionReason: context.revisionReason,
          promptLength: effectivePrompt.length,
        });
        onPromptBuilt?.(effectivePrompt);
      }
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
        sdkPermissionMode: 'acceptEdits',
        ...(disallowedTools ? { disallowedTools } : {}),
        ...(composedHooks ? { hooks: composedHooks } : {}),
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
          sdkPermissionMode: 'acceptEdits',
          ...(disallowedTools ? { disallowedTools } : {}),
          ...(composedHooks ? { hooks: composedHooks } : {}),
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

      // Best-effort cleanup of verification script directories (e.g., ${workdir}/tmp/)
      for (const relPath of execConfig.cleanupPaths ?? []) {
        try {
          const absPath = resolve(context.workdir, relPath);
          // Safety: only delete strict children of workdir — never the workdir root itself
          if (absPath.startsWith(resolvedWorkdir + '/') && absPath !== resolvedWorkdir) {
            execSync(`rm -rf "${absPath}"`, { timeout: 5000 });
          }
        } catch { /* best-effort cleanup — don't block agent completion */ }
      }
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
