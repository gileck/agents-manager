import type { AgentRunResult, RevisionReason, ImplementationPhase, TaskUpdateInput } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { parseRawContent, parseSubtasks, extractTaskEstimates, saveContextEntry } from './post-run-utils';

/**
 * Post-run handler for the planner agent.
 *
 * Extracts plan content, subtasks/phases, and persists them via TaskAPI.
 * Colocated with planner-prompt-builder.ts — the prompt defines the LLM
 * output shape, and this handler maps it to persistence.
 */
export async function plannerPostRunHandler(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  revisionReason: RevisionReason | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  // --- Extract plan document ---
  await extractPlanDoc(taskApi, result, onLog, onPostLog);

  // --- Extract task estimates (size/complexity) ---
  await extractTaskEstimates(taskApi, result, 'planner', onLog, onPostLog);

  // --- Save context entry ---
  await saveContextEntry(taskApi, agentRunId ?? '', 'planner', revisionReason, result, {}, onLog, onPostLog);

  // --- Mark plan_feedback as addressed ---
  if (agentRunId && result.exitCode === 0) {
    try {
      const count = await markFeedback(taskApi, ['plan_feedback'], agentRunId, onLog);
      if (count) onLog(`Marked plan_feedback as addressed`);
    } catch (err) {
      onLog(`Warning: failed to mark plan_feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function extractPlanDoc(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  if (result.exitCode !== 0) {
    onPostLog?.('extractPlan skipped (non-zero exit code)', { exitCode: result.exitCode });
    return;
  }
  const _start = performance.now();

  const so = result.structuredOutput as {
    plan?: string;
    planSummary?: string;
    subtasks?: string[];
    phases?: Array<{ name: string; subtasks: string[] }>;
  } | undefined;

  const reportContent = so?.plan;

  if (reportContent) {
    onLog(`Extracting plan from structured output: hasContent=${!!reportContent}, hasSubtasks=${!!so?.subtasks}, subtaskCount=${so?.subtasks?.length ?? 0}, hasPhases=${!!so?.phases}, phaseCount=${so?.phases?.length ?? 0}`);

    // Write subtasks/phases to task store
    const updates: TaskUpdateInput = {};
    if (so?.phases && so.phases.length > 1) {
      const phases: ImplementationPhase[] = so.phases.map((p, idx) => ({
        id: `phase-${idx + 1}`,
        name: p.name,
        status: idx === 0 ? 'in_progress' as const : 'pending' as const,
        subtasks: p.subtasks.map(name => ({ name, status: 'open' as const })),
      }));
      updates.phases = phases;
      updates.subtasks = []; // subtasks live inside phases
      onLog(`Multi-phase plan created with ${phases.length} phases`);
    } else if (so?.subtasks && so.subtasks.length > 0) {
      updates.subtasks = so.subtasks.map(name => ({ name, status: 'open' as const }));
    }
    if (Object.keys(updates).length > 0) {
      await taskApi.updateTask(updates);
    }

    // Write to task_docs table
    try {
      await taskApi.upsertDoc('plan', reportContent, so?.planSummary ?? null);
    } catch (err) {
      onLog(`Warning: failed to upsert task doc (type=plan): ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // Fallback: parse raw output if structured output unavailable
    onLog('Structured output unavailable, falling back to raw output parsing');
    const fallbackContent = parseRawContent(result.output);

    if (fallbackContent) {
      try {
        await taskApi.upsertDoc('plan', fallbackContent, null);
      } catch (err) {
        onLog(`Warning: failed to upsert task doc (type=plan): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const subtasks = parseSubtasks(result.output);
      if (subtasks.length > 0) {
        await taskApi.updateTask({ subtasks });
      }
    } catch {
      // Non-fatal
    }
  }

  const _duration = Math.round(performance.now() - _start);
  onPostLog?.('extractPlan complete', { hasContent: !!reportContent, subtaskCount: so?.subtasks?.length ?? 0, phaseCount: so?.phases?.length ?? 0 }, _duration);
}

async function markFeedback(
  taskApi: ITaskAPI,
  feedbackTypes: string[],
  agentRunId: string,
  onLog: OnLog,
): Promise<boolean> {
  try {
    await taskApi.markFeedbackAsAddressed(feedbackTypes, agentRunId);
    return true;
  } catch (err) {
    onLog(`Warning: failed to mark feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
