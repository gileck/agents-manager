import type { AgentChatMessage } from '../../shared/types';

// ============================================
// Agent Lib — Low-level engine interface
// ============================================

export interface ModelTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface AgentLibFeatures {
  images: boolean;
  hooks: boolean;
  thinking: boolean;
  nativeResume: boolean;
}

/** Preset-based system prompt: uses the SDK's built-in prompt with optional appended instructions. */
export interface SystemPromptPreset {
  type: 'preset';
  preset: 'claude_code';
  append?: string;
}

export interface AgentLibRunOptions {
  prompt: string;
  systemPrompt?: string | SystemPromptPreset;
  cwd: string;
  model?: string;
  maxTurns: number;
  timeoutMs: number;
  outputFormat?: object;
  allowedPaths: string[];
  readOnlyPaths: string[];
  readOnly: boolean;
  /** Tool names to completely remove from the model's context (cannot be used at all). */
  disallowedTools?: string[];
  images?: Array<{ base64: string; mediaType: string }>;
  sessionId?: string;
  resumeSession?: boolean;
  taskId?: string;
  agentType?: string;
  mcpServers?: Record<string, unknown>;
  /** Maximum spend allowed for this execution in USD. Supported by claude-code engine only. */
  maxBudgetUsd?: number;
  /** SDK beta feature flags to enable (e.g., extended context). Supported by claude-code engine only. */
  betas?: string[];
  /** Intercept tool calls to allow, deny, or modify them. Used for AskUserQuestion handling. */
  canUseTool?: (toolName: string, input: Record<string, unknown>) => Promise<
    { behavior: 'allow'; updatedInput?: Record<string, unknown> } |
    { behavior: 'deny'; message: string }
  >;
  /** Control which filesystem settings to load (e.g., ['project'] to auto-load CLAUDE.md). Supported by claude-code engine only. */
  settingSources?: Array<'user' | 'project' | 'local'>;
}

export interface AgentLibCallbacks {
  onOutput?: (chunk: string) => void;
  onLog?: (message: string, data?: Record<string, unknown>) => void;
  onMessage?: (msg: AgentChatMessage) => void;
  onUserToolResult?: (toolUseId: string, content: string) => void;
  /** Called when a stream delta event is received (partial message streaming). */
  onStreamEvent?: (event: { type: string; [key: string]: unknown }) => void;
}

export interface AgentLibResult {
  exitCode: number;
  output: string;
  error?: string;
  costInputTokens?: number;
  costOutputTokens?: number;
  /** Cache read input tokens (billed at reduced rate). */
  cacheReadInputTokens?: number;
  /** Cache creation input tokens (billed at premium rate). */
  cacheCreationInputTokens?: number;
  /** Authoritative total cost in USD from the SDK (includes cache pricing, multi-model, etc.). */
  totalCostUsd?: number;
  /** Input tokens from the last assistant message — represents actual context window usage. */
  lastContextInputTokens?: number;
  model?: string;
  structuredOutput?: Record<string, unknown>;
  /** Why the process was killed: 'timeout', 'stopped' (user/supervisor), or 'external_signal'. */
  killReason?: string;
  /** Original OS exit code (e.g. 143 for SIGTERM, 137 for SIGKILL). */
  rawExitCode?: number;
  /** Context window size for the primary model (from SDK modelUsage). */
  contextWindow?: number;
  /** Maximum output tokens for the primary model (from SDK modelUsage). */
  maxOutputTokens?: number;
  /** Wall-clock duration of the SDK query in milliseconds. */
  durationMs?: number;
  /** Cumulative API call duration in milliseconds. */
  durationApiMs?: number;
  /** Number of agent turns (assistant messages) in the conversation. */
  numTurns?: number;
  /** Per-model token usage breakdown from the SDK. */
  modelUsage?: Record<string, ModelTokenUsage>;
}

export interface AgentLibTelemetry {
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
  accumulatedCacheReadInputTokens: number;
  accumulatedCacheCreationInputTokens: number;
  messageCount: number;
  timeout?: number;
  maxTurns?: number;
}

export interface AgentLibModelOption {
  value: string;
  label: string;
}

export interface IAgentLib {
  readonly name: string;
  supportedFeatures(): AgentLibFeatures;
  getDefaultModel(): string;
  getSupportedModels(): AgentLibModelOption[];
  execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  getTelemetry(runId: string): AgentLibTelemetry | null;
}
