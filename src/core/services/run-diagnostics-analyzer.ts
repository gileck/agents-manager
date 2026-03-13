import type { AgentChatMessage, RunDiagnostics } from '../../shared/types';

export type { RunDiagnostics };

/**
 * Analyze an agent run's message trace and produce diagnostic metrics.
 * This is a pure function — no side effects, no DB access.
 */
export function analyzeRunMessages(
  messages: AgentChatMessage[],
  hadStructuredOutput: boolean,
): RunDiagnostics {
  if (messages.length === 0) {
    return emptyDiagnostics(hadStructuredOutput);
  }

  const firstTs = messages[0].timestamp;
  const lastTs = messages[messages.length - 1].timestamp;
  const wallTimeSec = Math.max(0, (lastTs - firstTs) / 1000);

  // --- Tool call analysis ---
  const toolCounts: Record<string, number> = {};
  let subagentSpawns = 0;
  const toolUseTimestamps = new Map<string, { ts: number; toolName: string; input: string; parentToolUseId?: string }>();
  const fileReadPaths: string[] = [];
  let subagentFileReads = 0;

  // Subagent tracking: toolUseIds that are subagent spawns
  const subagentToolUseIds = new Set<string>();

  // Time accumulators
  let subagentSec = 0;
  let directToolSec = 0;

  // Turn counting: count thinking messages at the root level (not inside subagents)
  let turnCount = 0;

  // Track compaction events
  let compactionCount = 0;

  for (const msg of messages) {
    switch (msg.type) {
      case 'tool_use': {
        const toolName = msg.toolName;
        toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;

        if (msg.toolId) {
          toolUseTimestamps.set(msg.toolId, {
            ts: msg.timestamp,
            toolName,
            input: typeof msg.input === 'string' ? msg.input : JSON.stringify(msg.input),
            parentToolUseId: msg.parentToolUseId,
          });
        }

        // Detect subagent spawns
        if (toolName === 'Agent' || toolName === 'Task') {
          subagentSpawns++;
          if (msg.toolId) subagentToolUseIds.add(msg.toolId);
        }

        // Track file reads
        if (toolName === 'Read' || toolName === 'read' || toolName === 'ReadFile') {
          try {
            const input = typeof msg.input === 'string' ? JSON.parse(msg.input) : msg.input;
            const filePath = input?.file_path || input?.path;
            if (filePath) {
              fileReadPaths.push(filePath);
              if (msg.parentToolUseId) {
                subagentFileReads++;
              }
            }
          } catch {
            // Input parsing failed — still count the read
          }
        }
        break;
      }

      case 'tool_result': {
        if (msg.toolId) {
          const useInfo = toolUseTimestamps.get(msg.toolId);
          if (useInfo) {
            const durationSec = Math.max(0, (msg.timestamp - useInfo.ts) / 1000);
            if (subagentToolUseIds.has(msg.toolId)) {
              subagentSec += durationSec;
            } else {
              directToolSec += durationSec;
            }
          }
        }
        break;
      }

      case 'thinking': {
        // Only count root-level thinking as turns
        if (!msg.parentToolUseId) {
          turnCount++;
        }
        break;
      }

      case 'compact_boundary': {
        compactionCount++;
        break;
      }
    }
  }

  // --- File read dedup analysis ---
  const fileReadCount: Record<string, number> = {};
  for (const p of fileReadPaths) {
    fileReadCount[p] = (fileReadCount[p] || 0) + 1;
  }
  const duplicates: Record<string, number> = {};
  for (const [path, count] of Object.entries(fileReadCount)) {
    if (count > 1) duplicates[path] = count;
  }

  // --- Build subagent details ---
  const subagents: RunDiagnostics['subagents'] = [];
  for (const toolId of subagentToolUseIds) {
    const useInfo = toolUseTimestamps.get(toolId);
    if (!useInfo) continue;

    // Find matching tool_result
    const resultMsg = messages.find(
      m => m.type === 'tool_result' && 'toolId' in m && m.toolId === toolId,
    );
    const durationSec = resultMsg
      ? Math.max(0, (resultMsg.timestamp - useInfo.ts) / 1000)
      : Math.max(0, (lastTs - useInfo.ts) / 1000); // still running at end

    subagents.push({
      toolUseId: toolId,
      durationSec,
      description: useInfo.input.slice(0, 200),
    });
  }

  // Thinking/other time is the residual: wall time minus tool execution time
  const thinkingSec = Math.max(0, wallTimeSec - subagentSec - directToolSec);

  return {
    wallTimeSec,
    timeBreakdown: {
      subagentSec: round2(subagentSec),
      directToolSec: round2(directToolSec),
      thinkingSec: round2(thinkingSec),
    },
    turnCount,
    toolCalls: {
      total: Object.values(toolCounts).reduce((a, b) => a + b, 0),
      byTool: toolCounts,
      subagentSpawns,
    },
    fileReads: {
      total: fileReadPaths.length,
      uniqueFiles: Object.keys(fileReadCount).length,
      duplicates,
      subagentReads: subagentFileReads,
    },
    subagents,
    compactionCount,
    producedOutput: hadStructuredOutput,
  };
}

/** Format diagnostics into a human-readable summary string for logging. */
export function formatDiagnosticsSummary(d: RunDiagnostics): string {
  const lines: string[] = [];

  lines.push(`Wall time: ${formatDuration(d.wallTimeSec)}`);
  lines.push(`Turns: ${d.turnCount}`);

  // Time breakdown
  const { subagentSec, directToolSec, thinkingSec } = d.timeBreakdown;
  const accountedSec = subagentSec + directToolSec + thinkingSec;
  const otherSec = Math.max(0, d.wallTimeSec - accountedSec);
  lines.push(`Time breakdown: subagents=${formatDuration(subagentSec)}, tools=${formatDuration(directToolSec)}, thinking=${formatDuration(thinkingSec)}, other=${formatDuration(otherSec)}`);

  // Tool calls
  const topTools = Object.entries(d.toolCalls.byTool)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `${name}(${count})`)
    .join(', ');
  lines.push(`Tool calls: ${d.toolCalls.total} total — ${topTools}`);

  if (d.toolCalls.subagentSpawns > 0) {
    lines.push(`Subagent spawns: ${d.toolCalls.subagentSpawns}`);
    for (const sa of d.subagents) {
      lines.push(`  - ${formatDuration(sa.durationSec)}: ${sa.description.slice(0, 100)}`);
    }
  }

  // File reads
  lines.push(`File reads: ${d.fileReads.total} total, ${d.fileReads.uniqueFiles} unique`);
  if (Object.keys(d.fileReads.duplicates).length > 0) {
    const dupEntries = Object.entries(d.fileReads.duplicates)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => `${shortPath(path)}(${count}x)`)
      .join(', ');
    lines.push(`Duplicate reads: ${dupEntries}`);
  }
  if (d.fileReads.subagentReads > 0) {
    lines.push(`Subagent file reads: ${d.fileReads.subagentReads} (potential overlap with direct reads)`);
  }

  if (d.compactionCount > 0) {
    lines.push(`Context compactions: ${d.compactionCount} (context window pressure)`);
  }

  lines.push(`Produced output: ${d.producedOutput ? 'yes' : 'NO — timed out or failed before output'}`);

  return lines.join('\n');
}

// --- Helpers ---

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.floor(sec / 60);
  const remainingSec = Math.round(sec % 60);
  return `${min}m${remainingSec}s`;
}

function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : p;
}

function emptyDiagnostics(hadStructuredOutput: boolean): RunDiagnostics {
  return {
    wallTimeSec: 0,
    timeBreakdown: { subagentSec: 0, directToolSec: 0, thinkingSec: 0 },
    turnCount: 0,
    toolCalls: { total: 0, byTool: {}, subagentSpawns: 0 },
    fileReads: { total: 0, uniqueFiles: 0, duplicates: {}, subagentReads: 0 },
    subagents: [],
    compactionCount: 0,
    producedOutput: hadStructuredOutput,
  };
}
