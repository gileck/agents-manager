import type { AgentRunResult, RevisionReason } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { extractTaskEstimates, saveContextEntry } from './post-run-utils';

/**
 * Post-run handler for the triager agent.
 *
 * Extracts triage data (suggestedPhase, relevanceVerdict, etc.) and saves context entry.
 */
export async function triagerPostRunHandler(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  revisionReason: RevisionReason | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  // Build agent-specific entry data
  const entryData: Record<string, unknown> = {};
  if (result.exitCode === 0) {
    const tso = result.structuredOutput as { suggestedPhase?: string; phaseSkipJustification?: string; relevanceVerdict?: string } | undefined;
    if (tso?.suggestedPhase) entryData.suggestedPhase = tso.suggestedPhase;
    if (tso?.phaseSkipJustification) entryData.phaseSkipJustification = tso.phaseSkipJustification;
    if (tso?.relevanceVerdict) entryData.relevanceVerdict = tso.relevanceVerdict;
  }

  // --- Extract task estimates (size/complexity) ---
  await extractTaskEstimates(taskApi, result, 'triager', onLog, onPostLog);

  // --- Save context entry ---
  await saveContextEntry(taskApi, agentRunId ?? '', 'triager', revisionReason, result, entryData, onLog, onPostLog);
}
