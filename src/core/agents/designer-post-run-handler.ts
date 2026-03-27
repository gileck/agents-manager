import type { AgentRunResult, RevisionReason } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { parseRawContent, extractTaskEstimates, saveContextEntry } from './post-run-utils';

/**
 * Post-run handler for the designer agent.
 *
 * Extracts technical design content and persists it via TaskAPI.
 */
export async function designerPostRunHandler(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  revisionReason: RevisionReason | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  // --- Extract technical design document ---
  await extractTechnicalDesign(taskApi, result, agentRunId, onLog, onPostLog);

  // --- Extract task estimates (size/complexity) ---
  await extractTaskEstimates(taskApi, result, 'designer', onLog, onPostLog);

  // --- Save context entry ---
  await saveContextEntry(taskApi, agentRunId ?? '', 'designer', revisionReason, result, {}, onLog, onPostLog);
}

async function extractTechnicalDesign(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  if (result.exitCode !== 0) {
    onPostLog?.('extractTechnicalDesign skipped (non-zero exit code)', { exitCode: result.exitCode });
    return;
  }
  const _start = performance.now();

  const so = result.structuredOutput as { technicalDesign?: string; designSummary?: string } | undefined;
  if (so?.technicalDesign) {
    onLog(`Extracting technical design from structured output: hasDesign=${!!so.technicalDesign}`);

    try {
      await taskApi.upsertDoc('technical_design', so.technicalDesign, so?.designSummary ?? null);
    } catch (err) {
      onLog(`Warning: failed to upsert task doc (type=technical_design): ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // Fallback: store raw output as technical design
    const fallback = parseRawContent(result.output);
    if (fallback) {
      try {
        await taskApi.upsertDoc('technical_design', fallback, null);
      } catch (err) {
        onLog(`Warning: failed to upsert task doc (type=technical_design): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Mark design_feedback as addressed
  if (agentRunId) {
    try {
      await taskApi.markFeedbackAsAddressed(['design_feedback'], agentRunId);
    } catch (err) {
      onLog(`Warning: failed to mark design_feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const _duration = Math.round(performance.now() - _start);
  onPostLog?.('extractTechnicalDesign complete', { hasDesign: !!so?.technicalDesign }, _duration);
}
