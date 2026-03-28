import type { AgentChatMessage, AskUserQuestionItem, PermissionMode } from '../../shared/types';
import type { GenericMcpToolDefinition } from './mcp-tool';

// ============================================
// Permission Request/Response Types
// ============================================

/** A permission request sent to the UI for user approval before tool execution. */
export interface PermissionRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

/** The user's response to a permission request. */
export interface PermissionResponse {
  allowed: boolean;
}

export interface ClientToolCallRequest {
  toolName: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
  signal: AbortSignal;
}

export interface ClientToolCallResponse {
  handled: boolean;
  success: boolean;
  content: string;
}

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
  /** Whether the engine supports mid-execution message injection via AsyncGenerator streaming input. */
  streamingInput: boolean;
}

// ============================================
// Hook Input/Output Types (aligned with SDK hook types)
// ============================================

/** Input for PreToolUse hooks — called before a tool executes. */
export interface PreToolUseHookInput {
  hookEventName: 'PreToolUse';
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
}

/** Output for PreToolUse hooks — can allow, deny, or modify tool input. */
export interface PreToolUseHookOutput {
  decision?: 'allow' | 'deny';
  reason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
}

/** Input for PostToolUse hooks — called after a tool completes. */
export interface PostToolUseHookInput {
  hookEventName: 'PostToolUse';
  toolName: string;
  toolInput: unknown;
  toolResponse: unknown;
  toolUseId: string;
}

/** Output for PostToolUse hooks. */
export interface PostToolUseHookOutput {
  additionalContext?: string;
}

/** Input for PostToolUseFailure hooks — called when a tool fails. */
export interface PostToolUseFailureHookInput {
  hookEventName: 'PostToolUseFailure';
  toolName: string;
  toolInput: unknown;
  error: string;
  toolUseId: string;
}

/** Output for PostToolUseFailure hooks. */
export interface PostToolUseFailureHookOutput {
  additionalContext?: string;
}

/** Input for Notification hooks — called when the agent emits a notification. */
export interface NotificationHookInput {
  hookEventName: 'Notification';
  message: string;
  title?: string;
  notificationType: string;
}

/** Output for Notification hooks. */
export interface NotificationHookOutput {
  additionalContext?: string;
}

/** Input for Stop hooks — called when the agent stops. */
export interface StopHookInput {
  hookEventName: 'Stop';
  stopHookActive: boolean;
}

/** Input for SubagentStart hooks — called when a subagent starts. */
export interface SubagentStartHookInput {
  hookEventName: 'SubagentStart';
  agentId: string;
  agentType: string;
}

/** Output for SubagentStart hooks. */
export interface SubagentStartHookOutput {
  additionalContext?: string;
}

/** Input for SubagentStop hooks — called when a subagent stops. */
export interface SubagentStopHookInput {
  hookEventName: 'SubagentStop';
  stopHookActive: boolean;
  agentId: string;
  agentType: string;
}

/** Input for PreCompact hooks — called before context compaction. */
export interface PreCompactHookInput {
  hookEventName: 'PreCompact';
  trigger: 'manual' | 'auto';
  customInstructions: string | null;
}

export type AgentLibHookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | NotificationHookInput
  | StopHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | PreCompactHookInput;

export type AgentLibHookOutput =
  | PreToolUseHookOutput
  | PostToolUseHookOutput
  | PostToolUseFailureHookOutput
  | NotificationHookOutput
  | SubagentStartHookOutput
  | void;

/**
 * Full hooks interface for agent execution.
 * Each hook type maps to a callback that receives the hook-specific input
 * and optionally returns hook-specific output.
 *
 * PreToolUse uses the legacy signature for backward compatibility with
 * the existing sandbox guard integration.
 */
export interface AgentLibHooks {
  /** Called before each tool execution. Return a decision to allow/block. */
  preToolUse?: (toolName: string, toolInput: Record<string, unknown>) =>
    { decision: 'block' | 'allow'; reason?: string } | undefined;
  /** Called after a tool completes successfully. */
  postToolUse?: (input: PostToolUseHookInput) => PostToolUseHookOutput | void;
  /** Called after a tool fails. */
  postToolUseFailure?: (input: PostToolUseFailureHookInput) => PostToolUseFailureHookOutput | void;
  /** Called when the agent emits a notification. */
  notification?: (input: NotificationHookInput) => NotificationHookOutput | void;
  /** Called when the agent stops. */
  stop?: (input: StopHookInput) => void;
  /** Called when a subagent starts. */
  subagentStart?: (input: SubagentStartHookInput) => SubagentStartHookOutput | void;
  /** Called when a subagent stops. */
  subagentStop?: (input: SubagentStopHookInput) => void;
  /** Called before context compaction. */
  preCompact?: (input: PreCompactHookInput) => void;
}

// ============================================
// Subagent Definition Types
// ============================================

/** Definition for a custom subagent that can be invoked via the Task tool. */
export interface SubagentDefinition {
  /** Natural language description of when to use this agent. */
  description: string;
  /** The agent's system prompt. */
  prompt: string;
  /** Array of allowed tool names. If omitted, inherits all tools from parent. */
  tools?: string[];
  /** Array of tool names to explicitly disallow for this agent. */
  disallowedTools?: string[];
  /** Model to use for this agent: 'sonnet', 'opus', 'haiku', or 'inherit' (default). */
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
  /** Maximum number of agentic turns before stopping. */
  maxTurns?: number;
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
  timeoutMs?: number;
  outputFormat?: object;
  allowedPaths: string[];
  readOnlyPaths: string[];
  readOnly: boolean;
  /** Tool names to completely remove from the model's context (cannot be used at all). */
  disallowedTools?: string[];
  hooks?: AgentLibHooks;
  images?: Array<{ base64: string; mediaType: string }>;
  sessionId?: string;
  resumeSession?: boolean;
  taskId?: string;
  agentType?: string;
  mcpServers?: Record<string, unknown>;
  /**
   * In-process MCP tool definitions keyed by server name.
   * Each entry becomes a separate SDK MCP server. Engine adapters convert
   * these into their own native format; unknown engines may ignore the field.
   * Example: `{ 'task-manager': [...tools] }`
   */
  mcpTools?: Record<string, GenericMcpToolDefinition[]>;
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
  /** Custom subagent definitions that the main agent can delegate tasks to via the Task tool. Supported by claude-code engine only. */
  agents?: Record<string, SubagentDefinition>;
  /** Plugins to load for this session. Each plugin extends the agent with custom commands, skills, hooks, etc. Supported by claude-code engine only. */
  plugins?: Array<{ type: 'local'; path: string }>;
  /** Generic permission mode selected by the caller. Engines may map this to engine-specific sandbox/approval settings. */
  permissionMode?: PermissionMode;
  /** SDK-level permission mode. Defaults to 'acceptEdits' if not specified. */
  sdkPermissionMode?: string;
  /** When true, the engine should use a long-lived AsyncGenerator prompt to support mid-execution message injection. */
  enableStreamingInput?: boolean;
}

export interface AgentLibCallbacks {
  onOutput?: (chunk: string) => void;
  onLog?: (message: string, data?: Record<string, unknown>) => void;
  onMessage?: (msg: AgentChatMessage) => void;
  onUserToolResult?: (toolUseId: string, content: string) => void;
  onQuestionRequest?: (request: { questionId: string; questions: AskUserQuestionItem[] }) => Promise<Record<string, string[]>>;
  onClientToolCall?: (request: ClientToolCallRequest) => Promise<ClientToolCallResponse>;
  /** Called when a stream delta event is received (partial message streaming). */
  onStreamEvent?: (event: { type: string; [key: string]: unknown }) => void;
  /** Called when a tool needs user permission approval. Blocks tool execution until resolved. */
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionResponse>;
  /**
   * Called when the SDK finishes processing a turn but the session stays alive
   * (enableStreamingInput mode). Allows the caller to emit per-turn completion
   * signals without waiting for execute() to return.
   */
  onTurnComplete?: () => void;
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

// ============================================
// Query Event Types — for one-shot summarization/naming queries
// ============================================

/** A text chunk emitted during a one-shot query. */
export interface QueryTextEvent {
  type: 'text';
  text: string;
}

/** Final result event emitted at the end of a one-shot query. */
export interface QueryResultEvent {
  type: 'result';
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
}

export type QueryEvent = QueryTextEvent | QueryResultEvent;

export interface IAgentLib {
  readonly name: string;
  supportedFeatures(): AgentLibFeatures;
  getDefaultModel(): string;
  getSupportedModels(): AgentLibModelOption[];
  execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  getTelemetry(runId: string): AgentLibTelemetry | null;
  /** One-shot query for summarization or naming. Optional — engines that don't support it throw. */
  query?(prompt: string, options?: { model?: string; maxTokens?: number }): AsyncIterable<QueryEvent>;
  /**
   * Inject a user message into a running agent session.
   * Only works when the engine supports streamingInput and the session was started with enableStreamingInput.
   * Returns true if the message was successfully injected, false if not supported or no active session.
   */
  injectMessage(runId: string, message: string, images?: Array<{ base64: string; mediaType: string }>): boolean;
}
