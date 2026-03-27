import type { AgentRunResult, RevisionReason } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { saveContextEntry } from './post-run-utils';

/**
 * Post-run handler for the implementor agent.
 *
 * Saves context entry and marks implementation/review feedback as addressed
 * when handling changes_requested revisions.
 */
export async function implementorPostRunHandler(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  revisionReason: RevisionReason | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  // --- Save context entry ---
  await saveContextEntry(taskApi, agentRunId ?? '', 'implementor', revisionReason, result, {}, onLog, onPostLog);

  // --- Mark feedback as addressed when implementor addresses reviewer changes ---
  if (result.exitCode === 0 && revisionReason === 'changes_requested' && agentRunId) {
    try {
      await taskApi.markFeedbackAsAddressed(['implementation_feedback', 'review_feedback'], agentRunId);
    } catch (err) {
      onLog(`Warning: failed to mark feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
