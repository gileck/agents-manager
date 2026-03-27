import type { RevisionReason, Subtask, TaskUpdateInput, TaskSize, TaskComplexity } from '../../shared/types';
import { VALID_TASK_SIZES, VALID_TASK_COMPLEXITIES } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { getAppLogger } from '../services/app-logger';

/**
 * Maps (agentType, revisionReason, outcome) to a context entry type string.
 *
 * Preserved as a shared utility since the mapping is stable and
 * used by multiple handlers.
 */
export function getContextEntryType(agentType: string, revisionReason?: RevisionReason, outcome?: string): string {
  if (agentType === 'task-workflow-reviewer') return 'workflow_review';
  if (agentType === 'post-mortem-reviewer') return 'post_mortem';
  if (agentType === 'reviewer') return outcome === 'approved' ? 'review_approved' : 'review_feedback';
  switch (agentType) {
    case 'triager':
      return 'triage_summary';
    case 'planner':
      return revisionReason === 'changes_requested' ? 'plan_revision_summary' : 'plan_summary';
    case 'investigator':
      return 'investigation_summary';
    case 'implementor':
      if (revisionReason === 'changes_requested') return 'fix_summary';
      if (revisionReason === 'merge_failed') return 'conflict_resolution_summary';
      return 'implementation_summary';
    case 'designer':
      return revisionReason === 'changes_requested' ? 'technical_design_revision_summary' : 'technical_design_summary';
    case 'ux-designer':
      return revisionReason === 'changes_requested' ? 'ux_design_revision_summary' : 'ux_design_summary';
    default:
      getAppLogger().warn('PostRunHandler', `getContextEntryType: unexpected agentType '${agentType}', using 'agent_output'`);
      return 'agent_output';
  }
}

/**
 * Parse raw agent output to extract a plan/report (stripping tool traces).
 * Used as a fallback when structured output is unavailable.
 */
export function parseRawContent(output: string): string {
  return output
    .split('\n')
    .filter(line => {
      if (line.startsWith('> Tool: ') || line.startsWith('> Input: ')) return false;
      if (/^\[[\w_]+\] /.test(line)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse a context summary from raw output.
 * Looks for a "## Summary" section at the end, or takes the last 500 chars.
 */
export function parseContextSummary(output: string): string {
  const trimmed = output.trimEnd();
  const match = trimmed.match(/## Summary\s*\n([\s\S]+)$/i);
  if (match) return match[1].trim().slice(0, 2000);
  return trimmed.slice(-500).trim();
}

/**
 * Parse subtasks from raw output (Markdown code block after "## Subtasks").
 */
export function parseSubtasks(output: string): Subtask[] {
  const match = output.match(/## Subtasks\s*\n[\s\S]*?```(?:json)?\s*\n([\s\S]*?)```/i);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) {
      const results: Subtask[] = [];
      for (const item of parsed) {
        if (typeof item === 'string') {
          results.push({ name: item, status: 'open' });
        } else if (typeof item === 'object' && item !== null && 'name' in item) {
          results.push({ name: String((item as { name: unknown }).name), status: 'open' });
        }
      }
      return results;
    }
  } catch {
    // Invalid JSON
  }
  return [];
}

/**
 * Extract and persist size/complexity estimates from structured output.
 * Used by agents that produce task estimates (planner, designer, investigator, triager).
 */
export async function extractTaskEstimates(
  taskApi: ITaskAPI,
  result: { exitCode: number; structuredOutput?: unknown },
  agentType: string,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  const estimatingAgents = ['planner', 'designer', 'investigator', 'triager'];
  if (result.exitCode !== 0 || !estimatingAgents.includes(agentType)) {
    onPostLog?.('extractTaskEstimates skipped (not applicable)', { agentType, exitCode: result.exitCode });
    return;
  }

  const _start = performance.now();
  const so = result.structuredOutput as { size?: string; complexity?: string } | undefined;
  if (!so) {
    onPostLog?.('extractTaskEstimates skipped (no structured output)');
    return;
  }

  try {
    const updates: TaskUpdateInput = {};
    if (so.size && (VALID_TASK_SIZES as readonly string[]).includes(so.size)) {
      updates.size = so.size as TaskSize;
    }
    if (so.complexity && (VALID_TASK_COMPLEXITIES as readonly string[]).includes(so.complexity)) {
      updates.complexity = so.complexity as TaskComplexity;
    }

    if (Object.keys(updates).length > 0) {
      onLog(`Extracting task estimates: size=${updates.size ?? 'none'}, complexity=${updates.complexity ?? 'none'}`);
      await taskApi.updateTask(updates);
    }
    const _duration = Math.round(performance.now() - _start);
    onPostLog?.(`extractTaskEstimates complete: size=${updates.size ?? 'none'}, complexity=${updates.complexity ?? 'none'}`, { size: updates.size, complexity: updates.complexity }, _duration);
  } catch (err) {
    // Non-fatal -- don't block pipeline on estimate extraction failure
    onLog(`Warning: failed to extract task estimates: ${err instanceof Error ? err.message : String(err)}`);
    onPostLog?.(`extractTaskEstimates failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Save a context entry for a successful run, capturing summary and metadata.
 * This is the common context-entry logic shared by all agents.
 * Agent-specific data is passed via the `entryData` parameter.
 */
export async function saveContextEntry(
  taskApi: ITaskAPI,
  agentRunId: string,
  agentType: string,
  revisionReason: RevisionReason | undefined,
  result: { exitCode: number; output: string; outcome?: string; structuredOutput?: unknown; payload?: Record<string, unknown> },
  entryData: Record<string, unknown>,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  if (result.exitCode !== 0) {
    onPostLog?.('saveContextEntry skipped (non-zero exit code)', { exitCode: result.exitCode });
    return;
  }
  const _start = performance.now();

  try {
    // Use structured output summary when available, fall back to parsing
    const so = result.structuredOutput as {
      summary?: string;
      triageSummary?: string;
      planSummary?: string;
      investigationSummary?: string;
      designSummary?: string;
      designOverview?: string;
    } | undefined;
    const structuredSummary = so?.triageSummary ?? so?.investigationSummary ?? so?.designSummary ?? so?.designOverview ?? so?.planSummary ?? so?.summary;
    const summary = structuredSummary || parseContextSummary(result.output);
    const entryType = getContextEntryType(agentType, revisionReason, result.outcome);
    onLog(`Saving context entry: type=${entryType}, source=${agentType === 'reviewer' ? 'reviewer' : 'agent'}, summaryLength=${summary.length}`);

    const entrySource = agentType === 'reviewer' ? 'reviewer'
      : agentType === 'task-workflow-reviewer' ? 'workflow-reviewer'
      : agentType === 'post-mortem-reviewer' ? 'post-mortem-reviewer'
      : 'agent';
    await taskApi.addContextEntry({
      agentRunId,
      source: entrySource,
      entryType, summary, data: entryData,
    });
  } catch (err) {
    // Non-fatal -- don't block pipeline on context entry failure
    await taskApi.logEvent({
      category: 'agent',
      severity: 'warning',
      message: `Failed to save context entry: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const _duration = Math.round(performance.now() - _start);
  onPostLog?.('saveContextEntry complete', { entryType: getContextEntryType(agentType, revisionReason, result.outcome) }, _duration);
}
