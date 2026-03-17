import type { AgentChatMessage, AgentChatMessageToolUse, AgentChatMessageToolResult, AgentChatMessageSubagentActivity } from '../../../../shared/types';

// Message types that are "leaf" nodes rendered directly in the timeline
export const LEAF_TYPES = new Set(['user', 'assistant_text', 'agent_run_info', 'status', 'compact_boundary', 'compacting', 'ask_user_question', 'stream_delta', 'permission_request', 'permission_response', 'notification', 'subagent_activity', 'slash_command']);
// Message types that always belong inside a ThinkingGroup
export const ALWAYS_GROUPED_TYPES = new Set(['thinking', 'usage']);
// Internal processing tools that should be grouped into ThinkingGroup
export const THINKING_TOOLS = new Set(['Read', 'Grep', 'Glob']);

export type LeafSegment = { type: 'leaf'; msg: AgentChatMessage; index: number };
export type GroupSegment = { type: 'group'; messages: AgentChatMessage[]; startIndex: number };
export type AgentSegment = {
  type: 'agent';
  taskToolUse: AgentChatMessageToolUse;
  taskToolResult?: AgentChatMessageToolResult;
  startedActivity?: AgentChatMessageSubagentActivity;
  completedActivity?: AgentChatMessageSubagentActivity;
  internalMessages: AgentChatMessage[];
  startIndex: number;
};
export type Segment = LeafSegment | GroupSegment | AgentSegment;

/** Check whether a message should be grouped into a ThinkingGroup. */
export function isGroupedMessage(msg: AgentChatMessage, toolIdToName: Map<string, string>): boolean {
  if (ALWAYS_GROUPED_TYPES.has(msg.type)) return true;
  if (msg.type === 'tool_use') {
    return THINKING_TOOLS.has((msg as AgentChatMessageToolUse).toolName);
  }
  if (msg.type === 'tool_result') {
    const toolName = (msg as AgentChatMessageToolResult).toolId
      ? toolIdToName.get((msg as AgentChatMessageToolResult).toolId!)
      : undefined;
    // If we can resolve the tool name, group only thinking tools; otherwise default inline
    return toolName ? THINKING_TOOLS.has(toolName) : false;
  }
  return false;
}

export function groupMessages(messages: AgentChatMessage[]): Segment[] {
  // Build toolId -> toolName map so tool_result messages can be classified
  const toolIdToName = new Map<string, string>();
  for (const msg of messages) {
    if (msg.type === 'tool_use') {
      const tu = msg as AgentChatMessageToolUse;
      if (tu.toolId) toolIdToName.set(tu.toolId, tu.toolName);
    }
  }

  // -- Agent pre-pass: identify Task tool_use messages and collect related messages --
  // The SDK's agent_id (stored as toolUseId on subagent_activity) does NOT match
  // the tool_use content block id (stored as toolId on tool_use). However, the
  // started and completed activities for the SAME agent always share the same
  // toolUseId. So we pre-group activities by toolUseId, then assign each pair
  // to the nearest preceding Task tool_use of the matching agent type.
  const agentSegments = new Map<number, AgentSegment>(); // keyed by Task tool_use index
  const consumedIndices = new Set<number>();

  // Step 1: Pre-group subagent_activity messages by their toolUseId (SDK agent_id).
  // This ensures started+completed from the same agent are always paired correctly,
  // even when multiple same-type agents complete out of order.
  const activityByAgentId = new Map<string, { startedIdx: number; completedIdx: number }>();
  for (let j = 0; j < messages.length; j++) {
    const m = messages[j];
    if (m.type !== 'subagent_activity') continue;
    const sa = m as AgentChatMessageSubagentActivity;
    if (!sa.toolUseId) continue;
    const entry = activityByAgentId.get(sa.toolUseId) ?? { startedIdx: -1, completedIdx: -1 };
    if (sa.status === 'started') entry.startedIdx = j;
    if (sa.status === 'completed') entry.completedIdx = j;
    activityByAgentId.set(sa.toolUseId, entry);
  }

  // Step 2: For each Task tool_use, find the closest matching activity pair.
  for (let idx = 0; idx < messages.length; idx++) {
    const msg = messages[idx];
    if (msg.type !== 'tool_use') continue;
    const tu = msg as AgentChatMessageToolUse;
    if (tu.toolName !== 'Task' && tu.toolName !== 'task') continue;
    if (!tu.toolId) continue;

    const toolId = tu.toolId;
    let subagentType: string | undefined;
    try {
      const parsed = JSON.parse(tu.input);
      subagentType = parsed.subagent_type;
    } catch { /* ignore */ }

    let startedActivity: AgentChatMessageSubagentActivity | undefined;
    let completedActivity: AgentChatMessageSubagentActivity | undefined;
    let taskToolResult: AgentChatMessageToolResult | undefined;
    let startedIdx = -1;
    let completedIdx = -1;

    // Find the best matching activity pair from the pre-built map.
    // Pick the pair whose started index is closest to (and after) this tool_use.
    for (const [, entry] of activityByAgentId) {
      if (consumedIndices.has(entry.startedIdx)) continue; // already claimed
      if (entry.startedIdx <= idx) continue; // must be after tool_use

      const startedMsg = messages[entry.startedIdx] as AgentChatMessageSubagentActivity;
      const typeMatches = !subagentType || startedMsg.agentName === subagentType;
      if (!typeMatches) continue;

      // Pick the closest matching pair (smallest startedIdx)
      if (startedIdx === -1 || entry.startedIdx < startedIdx) {
        startedActivity = startedMsg;
        startedIdx = entry.startedIdx;
        completedIdx = entry.completedIdx;
        completedActivity = completedIdx >= 0 ? messages[completedIdx] as AgentChatMessageSubagentActivity : undefined;
      }
    }

    // Find tool_result by toolId (this still works -- tool_result.toolId matches tool_use.toolId)
    for (let j = idx + 1; j < messages.length; j++) {
      const m = messages[j];
      if (m.type === 'tool_result') {
        const tr = m as AgentChatMessageToolResult;
        if (tr.toolId === toolId && !taskToolResult) {
          taskToolResult = tr;
          consumedIndices.add(j);
        }
      }
    }

    // Collect internal messages between started and completed (or end of messages).
    // Only consume messages that are internal to the subagent (thinking, tool_use,
    // tool_result, usage). Never consume user-facing messages like assistant_text,
    // user, or other leaf types -- those belong in the main chat timeline.
    // Messages with a parentToolUseId are also treated as subagent-internal.
    const INTERNAL_TYPES = new Set(['thinking', 'tool_use', 'tool_result', 'usage']);
    const internalMessages: AgentChatMessage[] = [];
    if (startedIdx >= 0) {
      consumedIndices.add(startedIdx);
      const endIdx = completedIdx >= 0 ? completedIdx : messages.length;
      for (let j = startedIdx + 1; j < endIdx; j++) {
        const m = messages[j];
        if (m.type === 'subagent_activity') continue; // skip nested/other activity markers
        if (m.type === 'tool_result' && (m as AgentChatMessageToolResult).toolId === toolId) continue;
        // Consume messages tagged with parentToolUseId (subagent-internal) or matching INTERNAL_TYPES
        const hasParentId = 'parentToolUseId' in m && !!(m as { parentToolUseId?: string }).parentToolUseId;
        if (!hasParentId && !INTERNAL_TYPES.has(m.type)) continue;
        internalMessages.push(m);
        consumedIndices.add(j);
      }
    }
    if (completedIdx >= 0) {
      consumedIndices.add(completedIdx);
    }

    // Mark the Task tool_use itself as consumed (will be emitted as AgentSegment)
    consumedIndices.add(idx);

    agentSegments.set(idx, {
      type: 'agent',
      taskToolUse: tu,
      taskToolResult,
      startedActivity,
      completedActivity,
      internalMessages,
      startIndex: idx,
    });
  }

  // -- Main pass: build segments, emitting AgentSegments at Task positions --
  const segments: Segment[] = [];
  let i = 0;

  while (i < messages.length) {
    // Emit AgentSegment at Task tool_use positions
    if (agentSegments.has(i)) {
      segments.push(agentSegments.get(i)!);
      i++;
      continue;
    }

    // Skip consumed indices (subagent_activity, internal tool calls, tool_results)
    if (consumedIndices.has(i)) {
      i++;
      continue;
    }

    const msg = messages[i];

    if (LEAF_TYPES.has(msg.type)) {
      segments.push({ type: 'leaf', msg, index: i });
      i++;
    } else if (isGroupedMessage(msg, toolIdToName)) {
      const startIndex = i;
      const groupMsgs: AgentChatMessage[] = [];
      while (i < messages.length && !consumedIndices.has(i) && isGroupedMessage(messages[i], toolIdToName)) {
        groupMsgs.push(messages[i]);
        i++;
      }
      if (groupMsgs.length > 0) {
        segments.push({ type: 'group', messages: groupMsgs, startIndex });
      }
    } else {
      // User-facing tool or unknown type -- render as leaf
      segments.push({ type: 'leaf', msg, index: i });
      i++;
    }
  }

  return segments;
}
