import type { AgentChatMessage } from '../../shared/types';

// ============================================
// Agent Lib — Low-level engine interface
// ============================================

export interface AgentLibRunOptions {
  prompt: string;
  cwd: string;
  model?: string;
  maxTurns: number;
  timeoutMs: number;
  outputFormat?: object;
  allowedPaths: string[];
  readOnlyPaths: string[];
  readOnly: boolean;
}

export interface AgentLibCallbacks {
  onOutput?: (chunk: string) => void;
  onLog?: (message: string, data?: Record<string, unknown>) => void;
  onMessage?: (msg: AgentChatMessage) => void;
}

export interface AgentLibResult {
  exitCode: number;
  output: string;
  error?: string;
  costInputTokens?: number;
  costOutputTokens?: number;
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
  getDefaultModel(): string;
  getSupportedModels(): AgentLibModelOption[];
  execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  getTelemetry(runId: string): AgentLibTelemetry | null;
}
