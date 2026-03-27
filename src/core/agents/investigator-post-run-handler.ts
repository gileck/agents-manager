import type { AgentRunResult, RevisionReason } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { parseRawContent, extractTaskEstimates, saveContextEntry } from './post-run-utils';

/**
 * Post-run handler for the investigator agent.
 *
 * Extracts investigation report, proposed fix options, source task links,
 * and persists them via TaskAPI.
 */
export async function investigatorPostRunHandler(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  revisionReason: RevisionReason | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  // --- Extract investigation report document ---
  await extractInvestigationReport(taskApi, result, agentRunId, onLog, onPostLog);

  // --- Extract task estimates (size/complexity) ---
  await extractTaskEstimates(taskApi, result, 'investigator', onLog, onPostLog);

  // --- Save context entry ---
  await saveContextEntry(taskApi, agentRunId ?? '', 'investigator', revisionReason, result, {}, onLog, onPostLog);

  // --- Link bug to source tasks ---
  await linkBugToSourceTasks(taskApi, result, onLog, onPostLog);
}

async function extractInvestigationReport(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  if (result.exitCode !== 0) {
    onPostLog?.('extractInvestigationReport skipped (non-zero exit code)', { exitCode: result.exitCode });
    return;
  }
  const _start = performance.now();

  const so = result.structuredOutput as {
    investigationReport?: string;
    plan?: string; // backward compat
    investigationSummary?: string;
    proposedOptions?: Array<{ id: string; label: string; description: string; recommended?: boolean }>;
  } | undefined;

  // Prefer investigationReport; fall back to plan for backward compat
  const reportContent = so?.investigationReport ?? so?.plan;

  if (reportContent) {
    onLog(`Extracting investigation report from structured output: hasContent=${!!reportContent}`);

    // Write to task_docs table
    try {
      await taskApi.upsertDoc('investigation_report', reportContent, so?.investigationSummary ?? null);
    } catch (err) {
      onLog(`Warning: failed to upsert task doc (type=investigation_report): ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // Fallback: parse raw output
    onLog('Structured output unavailable, falling back to raw output parsing');
    const fallbackContent = parseRawContent(result.output);
    if (fallbackContent) {
      try {
        await taskApi.upsertDoc('investigation_report', fallbackContent, null);
      } catch (err) {
        onLog(`Warning: failed to upsert task doc (type=investigation_report): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Mark investigation_feedback as addressed
  if (agentRunId) {
    try {
      await taskApi.markFeedbackAsAddressed(['investigation_feedback'], agentRunId);
    } catch (err) {
      onLog(`Warning: failed to mark investigation_feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Extract proposed fix options
  if (so?.proposedOptions && Array.isArray(so.proposedOptions) && so.proposedOptions.length > 0) {
    try {
      await taskApi.addContextEntry({
        agentRunId,
        source: 'agent',
        entryType: 'fix_options_proposed',
        summary: `${so.proposedOptions.length} fix option(s) proposed`,
        data: { options: so.proposedOptions },
      });
      onLog(`Saved ${so.proposedOptions.length} proposed fix options as context entry`);
    } catch (err) {
      onLog(`Warning: failed to save proposed fix options: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const _duration = Math.round(performance.now() - _start);
  onPostLog?.('extractInvestigationReport complete', { hasContent: !!reportContent }, _duration);
}

/**
 * After a successful investigator run, link the bug task to the source tasks
 * that introduced the defect. Sets metadata.sourceTaskId (backward compat)
 * and metadata.sourceTaskIds on the bug task, and adds the 'defective' tag
 * to each validated source task.
 *
 * Validates each source task: must exist and belong to the same project.
 * Invalid IDs are skipped with a warning event logged.
 */
async function linkBugToSourceTasks(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  if (result.exitCode !== 0) {
    onPostLog?.('linkBugToSourceTasks skipped (non-zero exit code)', { exitCode: result.exitCode });
    return;
  }
  const _start = performance.now();

  const so = result.structuredOutput as { sourceTaskIds?: string[] } | undefined;
  const rawIds = so?.sourceTaskIds;
  if (!rawIds || rawIds.length === 0) {
    onPostLog?.('linkBugToSourceTasks skipped (no sourceTaskIds in output)');
    return;
  }

  try {
    const bugTask = await taskApi.getTask();
    if (!bugTask) {
      onPostLog?.('linkBugToSourceTasks skipped (bug task not found)');
      return;
    }

    // Merge with any existing sourceTaskIds
    const existingMetadata = (bugTask.metadata ?? {}) as Record<string, unknown>;
    const existingSourceTaskIds = Array.isArray(existingMetadata.sourceTaskIds)
      ? (existingMetadata.sourceTaskIds as string[])
      : existingMetadata.sourceTaskId
        ? [existingMetadata.sourceTaskId as string]
        : [];

    const validatedIds: string[] = [];

    for (const id of rawIds) {
      if (typeof id !== 'string' || !id.trim()) continue;
      const trimmedId = id.trim();

      if (existingSourceTaskIds.includes(trimmedId)) {
        onLog(`Source task ${trimmedId} already linked — skipping`);
        validatedIds.push(trimmedId);
        continue;
      }

      // Validate the source task exists
      const sourceTask = await taskApi.getTaskById(trimmedId);
      if (!sourceTask) {
        onLog(`Warning: source task ${trimmedId} not found — skipping`);
        await taskApi.logEventForTask(taskApi.taskId, {
          category: 'agent',
          severity: 'warning',
          message: `linkBugToSourceTasks: source task ${trimmedId} not found — skipping`,
          data: { sourceTaskId: trimmedId },
        });
        continue;
      }

      // Ensure source task is in the same project
      if (sourceTask.projectId !== bugTask.projectId) {
        onLog(`Warning: source task ${trimmedId} belongs to a different project — skipping`);
        await taskApi.logEventForTask(taskApi.taskId, {
          category: 'agent',
          severity: 'warning',
          message: `linkBugToSourceTasks: source task ${trimmedId} belongs to project ${sourceTask.projectId}, bug is in ${bugTask.projectId} — skipping`,
          data: { sourceTaskId: trimmedId, sourceProjectId: sourceTask.projectId, bugProjectId: bugTask.projectId },
        });
        continue;
      }

      validatedIds.push(trimmedId);

      // Add 'defective' tag to the source task (de-duplicated)
      const existingTags = sourceTask.tags ?? [];
      if (!existingTags.includes('defective')) {
        await taskApi.updateTaskById(trimmedId, {
          tags: [...existingTags, 'defective'],
        });
        onLog(`Added 'defective' tag to source task ${trimmedId}`);
      }

      // Log event on the source task for traceability
      await taskApi.logEventForTask(trimmedId, {
        category: 'agent',
        severity: 'info',
        message: `Task marked as defective — linked from bug ${taskApi.taskId}`,
        data: { bugTaskId: taskApi.taskId, bugTitle: bugTask.title },
      });
    }

    if (validatedIds.length === 0) {
      onPostLog?.('linkBugToSourceTasks: no valid source tasks found after validation');
      return;
    }

    const allSourceTaskIds = [...new Set([...existingSourceTaskIds, ...validatedIds])];

    const updatedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      sourceTaskId: existingMetadata.sourceTaskId ?? allSourceTaskIds[0],
      sourceTaskIds: allSourceTaskIds,
    };
    await taskApi.updateTask({ metadata: updatedMetadata });

    onLog(`Linked bug to ${validatedIds.length} source task(s): ${validatedIds.join(', ')}`);
    await taskApi.logEvent({
      category: 'agent',
      severity: 'info',
      message: `Auto-linked bug to ${validatedIds.length} source task(s) from investigation`,
      data: { sourceTaskIds: allSourceTaskIds, newlyLinked: validatedIds.filter(id => !existingSourceTaskIds.includes(id)) },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    onLog(`Warning: linkBugToSourceTasks failed: ${errMsg}`);
    await taskApi.logEvent({
      category: 'agent',
      severity: 'warning',
      message: `Failed to link bug to source tasks: ${errMsg}`,
      data: { error: errMsg },
    });
  }
  const _duration = Math.round(performance.now() - _start);
  onPostLog?.('linkBugToSourceTasks complete', { sourceTaskIds: rawIds }, _duration);
}
