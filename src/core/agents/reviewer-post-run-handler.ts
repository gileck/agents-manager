import type { AgentRunResult, RevisionReason } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { saveContextEntry } from './post-run-utils';

/**
 * Post-run handler for the reviewer agent.
 *
 * Saves context entry with verdict and review comments.
 */
export async function reviewerPostRunHandler(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  revisionReason: RevisionReason | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  // Build agent-specific entry data
  const entryData: Record<string, unknown> = {};
  entryData.verdict = result.outcome;
  if (result.payload?.comments) {
    entryData.comments = result.payload.comments;
  }

  // --- Save context entry ---
  await saveContextEntry(taskApi, agentRunId ?? '', 'reviewer', revisionReason, result, entryData, onLog, onPostLog);
}
