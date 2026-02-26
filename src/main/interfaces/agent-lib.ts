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
  structuredOutput?: Record<string, unknown>;
}

export interface AgentLibTelemetry {
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
  messageCount: number;
  timeout?: number;
  maxTurns?: number;
}

export interface IAgentLib {
  readonly name: string;
  execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  getTelemetry(runId: string): AgentLibTelemetry | null;
}
