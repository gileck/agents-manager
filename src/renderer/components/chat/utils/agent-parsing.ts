import type { AgentChatMessage } from '../../../../shared/types';
import type { AgentSegment } from './group-messages';

/** Parse the Task tool_use input JSON to extract agent metadata. */
export function parseAgentInput(input: string): {
  subagentType: string;
  description: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  runInBackground?: boolean;
  resume?: string;
} {
  try {
    const parsed = JSON.parse(input);
    return {
      subagentType: parsed.subagent_type || 'agent',
      description: parsed.description || '',
      prompt: parsed.prompt || '',
      model: parsed.model,
      maxTurns: parsed.max_turns,
      runInBackground: parsed.run_in_background,
      resume: parsed.resume,
    };
  } catch {
    console.error('[AgentBlock] Failed to parse agent input JSON — this is a bug, input should never be malformed:', input.slice(0, 200));
    return { subagentType: 'agent', description: '[Error: failed to parse agent input]', prompt: '' };
  }
}

/** Format duration in seconds to human-readable string. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

/** Determine the agent's status from the segment data. */
export function getAgentStatus(segment: AgentSegment, sessionRunning?: boolean): 'initializing' | 'running' | 'completed' | 'stopped' | 'error' {
  if (segment.completedActivity) return 'completed';
  // Check if tool_result indicates an error
  if (segment.taskToolResult) {
    const result = segment.taskToolResult.result;
    if (result && (result.includes('Error') || result.includes('error') || result.includes('failed'))) {
      return 'error';
    }
    return 'completed';
  }
  // If session is no longer running but agent has no completion, it was stopped
  if (!sessionRunning && segment.startedActivity) return 'stopped';
  if (!sessionRunning) return 'stopped';
  if (segment.startedActivity) return 'running';
  return 'initializing';
}

/** Parse the agent result to extract clean output, stripping metadata like agentId and <usage> tags. */
export function parseAgentResult(raw: string): { cleanResult: string; agentId?: string; totalTokens?: number; toolUses?: number; durationMs?: number } {
  let cleanResult = raw;
  let agentId: string | undefined;
  let totalTokens: number | undefined;
  let toolUses: number | undefined;
  let durationMs: number | undefined;

  // Extract agentId line: "agentId: abc123 (for resuming...)"
  const agentIdMatch = cleanResult.match(/agentId:\s*(\S+)\s*\(for resuming[^)]*\)\n?/);
  if (agentIdMatch) {
    agentId = agentIdMatch[1];
    cleanResult = cleanResult.replace(agentIdMatch[0], '');
  }

  // Extract <usage> block
  const usageMatch = cleanResult.match(/<usage>\s*([\s\S]*?)\s*<\/usage>\n?/);
  if (usageMatch) {
    const usageContent = usageMatch[1];
    const tokensMatch = usageContent.match(/total_tokens:\s*(\d+)/);
    const toolUsesMatch = usageContent.match(/tool_uses:\s*(\d+)/);
    const durationMatch = usageContent.match(/duration_ms:\s*(\d+)/);
    if (tokensMatch) totalTokens = parseInt(tokensMatch[1], 10);
    if (toolUsesMatch) toolUses = parseInt(toolUsesMatch[1], 10);
    if (durationMatch) durationMs = parseInt(durationMatch[1], 10);
    cleanResult = cleanResult.replace(usageMatch[0], '');
  }

  return { cleanResult: cleanResult.trim(), agentId, totalTokens, toolUses, durationMs };
}

/** Count tool_use messages in internal messages. */
export function countToolCalls(internalMessages: AgentChatMessage[]): number {
  return internalMessages.filter(m => m.type === 'tool_use').length;
}
