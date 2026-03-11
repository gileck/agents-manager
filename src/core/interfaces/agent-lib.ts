import type { AgentChatMessage } from '../../shared/types';

// ============================================
// Agent Lib — Low-level engine interface
// ============================================

export interface AgentLibFeatures {
  images: boolean;
  hooks: boolean;
  thinking: boolean;
  nativeResume: boolean;
}

export interface AgentLibRunOptions {
  prompt: string;
  systemPrompt?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  cwd: string;
  model?: string;
  maxTurns: number;
  timeoutMs: number;
  outputFormat?: object;
  allowedPaths: string[];
  readOnlyPaths: string[];
  readOnly: boolean;
  hooks?: {
    preToolUse?: (toolName: string, toolInput: Record<string, unknown>) =>
      { decision: 'block' | 'allow'; reason?: string } | undefined;
  };
  images?: Array<{ base64: string; mediaType: string }>;
  sessionId?: string;
  resumeSession?: boolean;
  taskId?: string;
  agentType?: string;
  mcpServers?: Record<string, unknown>;
}

export interface AgentLibCallbacks {
  onOutput?: (chunk: string) => void;
  onLog?: (message: string, data?: Record<string, unknown>) => void;
  onMessage?: (msg: AgentChatMessage) => void;
  onUserToolResult?: (toolUseId: string, content: string) => void;
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
