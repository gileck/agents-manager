/**
 * Engine-agnostic message types for streaming query results.
 * These mirror the shape of @anthropic-ai/claude-agent-sdk message types
 * but without the SDK dependency, so chat-agent-service.ts stays engine-agnostic.
 */

export interface AgentQueryContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

export interface AgentQueryAssistantMessage {
  type: 'assistant';
  error?: string;
  message: { content: AgentQueryContentBlock[] };
}

export interface AgentQueryResultMessage {
  type: 'result';
  subtype?: string;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AgentQueryUserMessage {
  type: 'user';
  message?: { content: AgentQueryContentBlock[] | string };
  parent_tool_use_id?: string | null;
  session_id?: string;
}

export type AgentQueryMessage =
  | AgentQueryAssistantMessage
  | AgentQueryResultMessage
  | AgentQueryUserMessage
  | { type: string };
