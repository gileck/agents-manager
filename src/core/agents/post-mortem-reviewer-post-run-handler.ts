import type { AgentRunResult, RevisionReason, PostMortemData } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { saveContextEntry } from './post-run-utils';

/**
 * Post-run handler for the post-mortem-reviewer agent.
 *
 * Extracts post-mortem analysis data, persists it to the task field,
 * adds the post-mortem-done tag, and saves a context entry.
 */
export async function postMortemReviewerPostRunHandler(
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
    interface PostMortemReviewerOutput {
      rootCause?: string;
      severity?: string;
      responsibleAgents?: string[];
      analysis?: string;
      codebaseImprovements?: string[];
      suggestedTasks?: Array<{ title: string; description: string }>;
      architecturalAssessment?: { architectureSummary: string; issues: Array<{ area: string; description: string; impact: string; suggestion: string }> };
    }
    const pmso = result.structuredOutput as PostMortemReviewerOutput | undefined;
    entryData.rootCause = pmso?.rootCause;
    entryData.severity = pmso?.severity;
    entryData.responsibleAgents = pmso?.responsibleAgents;
    entryData.analysis = pmso?.analysis;
    entryData.codebaseImprovements = pmso?.codebaseImprovements;
    entryData.suggestedTasks = pmso?.suggestedTasks;
    entryData.architecturalAssessment = pmso?.architecturalAssessment;
  }

  // --- Save context entry ---
  await saveContextEntry(taskApi, agentRunId ?? '', 'post-mortem-reviewer', revisionReason, result, entryData, onLog, onPostLog);

  // --- Post-mortem specific: persist data to task field and add tag ---
  if (result.exitCode === 0) {
    // Save post-mortem data to task.postMortem field
    try {
      const pmData: PostMortemData = {};
      if (entryData.rootCause) pmData.rootCause = entryData.rootCause as string;
      if (entryData.severity) pmData.severity = entryData.severity as string;
      if (entryData.responsibleAgents) pmData.responsibleAgents = entryData.responsibleAgents as string[];
      if (entryData.analysis) pmData.analysis = entryData.analysis as string;
      if (entryData.codebaseImprovements) pmData.codebaseImprovements = entryData.codebaseImprovements as string[];
      if (entryData.suggestedTasks) pmData.suggestedTasks = entryData.suggestedTasks as PostMortemData['suggestedTasks'];
      if (entryData.architecturalAssessment) pmData.architecturalAssessment = entryData.architecturalAssessment as PostMortemData['architecturalAssessment'];
      await taskApi.updateTask({ postMortem: pmData });
      onLog('Saved post-mortem data to task field');
    } catch (pmErr) {
      onLog(`Warning: failed to save post-mortem to task field: ${pmErr instanceof Error ? pmErr.message : String(pmErr)}`);
    }

    // Add post-mortem-done tag
    try {
      const reviewedTask = await taskApi.getTask();
      if (reviewedTask) {
        const existingTags = reviewedTask.tags ?? [];
        if (!existingTags.includes('post-mortem-done')) {
          await taskApi.updateTask({ tags: [...existingTags, 'post-mortem-done'] });
        }
      }
    } catch (tagErr) {
      await taskApi.logEvent({
        category: 'agent',
        severity: 'warning',
        message: `Failed to add post-mortem-done tag: ${tagErr instanceof Error ? tagErr.message : String(tagErr)}`,
      });
    }
  }
}
