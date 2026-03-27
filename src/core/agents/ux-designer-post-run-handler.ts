import type { AgentRunResult, RevisionReason } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { extractTaskEstimates, saveContextEntry } from './post-run-utils';

/**
 * Post-run handler for the ux-designer agent.
 *
 * Extracts UX design metadata (options) and design spec, persists both via TaskAPI.
 */
export async function uxDesignerPostRunHandler(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  revisionReason: RevisionReason | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  // --- Extract UX design docs ---
  await extractUxDesign(taskApi, result, agentRunId, onLog, onPostLog);

  // --- Extract task estimates (size/complexity) ---
  await extractTaskEstimates(taskApi, result, 'ux-designer', onLog, onPostLog);

  // --- Save context entry ---
  await saveContextEntry(taskApi, agentRunId ?? '', 'ux-designer', revisionReason, result, {}, onLog, onPostLog);
}

async function extractUxDesign(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  if (result.exitCode !== 0) {
    onPostLog?.('extractUxDesign skipped (non-zero exit code)', { exitCode: result.exitCode });
    return;
  }
  const _start = performance.now();

  const so = result.structuredOutput as {
    designOverview?: string;
    options?: Array<{
      id: string;
      name: string;
      description: string;
      recommended: boolean;
      mocks: Array<{ label: string; path: string }>;
    }>;
    designSpec?: string;
  } | undefined;

  // Persist ux_design doc (option metadata with file paths)
  if (so?.designOverview || so?.options) {
    const uxDesignContent = JSON.stringify({
      designOverview: so.designOverview,
      options: so.options,
    }, null, 2);
    const summary = so.designOverview
      ? so.designOverview.slice(0, 200)
      : `${so.options?.length ?? 0} design option(s)`;
    onLog(`Extracting UX design: options=${so.options?.length ?? 0}, hasOverview=${!!so.designOverview}`);
    try {
      await taskApi.upsertDoc('ux_design', uxDesignContent, summary);
    } catch (err) {
      onLog(`Warning: failed to upsert task doc (type=ux_design): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Persist ux_design_spec doc (markdown spec for implementor)
  if (so?.designSpec) {
    const specSummary = so.designSpec.slice(0, 200);
    onLog(`Extracting UX design spec: length=${so.designSpec.length}`);
    try {
      await taskApi.upsertDoc('ux_design_spec', so.designSpec, specSummary);
    } catch (err) {
      onLog(`Warning: failed to upsert task doc (type=ux_design_spec): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Mark ux_design_feedback as addressed after successful run
  if (agentRunId) {
    try {
      await taskApi.markFeedbackAsAddressed(['ux_design_feedback'], agentRunId);
    } catch (err) {
      onLog(`Warning: failed to mark ux_design_feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const _duration = Math.round(performance.now() - _start);
  onPostLog?.('extractUxDesign complete', { hasOverview: !!so?.designOverview, optionCount: so?.options?.length ?? 0, hasSpec: !!so?.designSpec }, _duration);
}
