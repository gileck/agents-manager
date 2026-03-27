import type { AgentRunResult, RevisionReason, TaskSize, TaskComplexity, PipelinePhase } from '../../shared/types';
import {
  VALID_TASK_SIZES,
  VALID_TASK_COMPLEXITIES,
  ALL_PIPELINE_PHASES,
} from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';
import type { OnLog, OnPostLog } from './post-run-handler';
import { saveContextEntry } from './post-run-utils';

const PHASE_LABELS: Record<PipelinePhase, string> = {
  triaging: '\u{1F3F7}\u{FE0F} Triage',
  investigating: '\u{1F50D} Investigate',
  designing: '\u{1F3A8} Design',
  planning: '\u{1F4CB} Plan',
  implementing: '\u{1F6E0}\u{FE0F} Implement',
};

/**
 * Post-run handler for the task-workflow-reviewer agent.
 *
 * Extracts workflow review data, creates suggested tasks, and saves context entry.
 */
export async function taskWorkflowReviewerPostRunHandler(
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
    interface WorkflowReviewerOutput {
      overallVerdict?: string;
      findings?: unknown;
      promptImprovements?: unknown;
      processImprovements?: unknown;
      tokenCostAnalysis?: unknown;
      executionSummary?: unknown;
      suggestedTasks?: Array<{ title: string; description: string }>;
    }
    const wso = result.structuredOutput as WorkflowReviewerOutput | undefined;
    entryData.verdict = wso?.overallVerdict;
    entryData.findings = wso?.findings;
    entryData.promptImprovements = wso?.promptImprovements;
    entryData.processImprovements = wso?.processImprovements;
    entryData.tokenCostAnalysis = wso?.tokenCostAnalysis;
    entryData.executionSummary = wso?.executionSummary;
    entryData.suggestedTasks = wso?.suggestedTasks;
  }

  // --- Save context entry ---
  await saveContextEntry(taskApi, agentRunId ?? '', 'task-workflow-reviewer', revisionReason, result, entryData, onLog, onPostLog);

  // --- Create suggested tasks ---
  await createSuggestedTasks(taskApi, result, onLog, onPostLog);
}

async function createSuggestedTasks(
  taskApi: ITaskAPI,
  result: AgentRunResult,
  onLog: OnLog,
  onPostLog?: OnPostLog,
): Promise<void> {
  if (result.exitCode !== 0) {
    onPostLog?.('createSuggestedTasks skipped (non-zero exit code)', { exitCode: result.exitCode });
    return;
  }
  const _start = performance.now();

  const wso = result.structuredOutput as {
    suggestedTasks?: Array<{ title: string; description: string; type?: string; debugInfo?: string; priority?: number; size?: string; complexity?: string; startPhase?: string }>;
  } | undefined;

  const tasks = wso?.suggestedTasks;
  if (!tasks || tasks.length === 0) {
    onPostLog?.('createSuggestedTasks skipped (no suggested tasks)');
    return;
  }

  try {
    const reviewedTask = await taskApi.getTask();
    if (!reviewedTask) return;

    const AGENT_PIPELINE_ID = 'pipeline-agent';
    let created = 0;

    for (const suggested of tasks) {
      if (!suggested.title) continue;
      const priority = typeof suggested.priority === 'number' && suggested.priority >= 0 && suggested.priority <= 3
        ? suggested.priority : 2;
      const validTypes = ['bug', 'feature', 'improvement'];
      const taskType = suggested.type && validTypes.includes(suggested.type)
        ? suggested.type as 'bug' | 'feature' | 'improvement'
        : 'improvement';
      const taskSize = suggested.size && (VALID_TASK_SIZES as readonly string[]).includes(suggested.size)
        ? suggested.size as TaskSize : undefined;
      const taskComplexity = suggested.complexity && (VALID_TASK_COMPLEXITIES as readonly string[]).includes(suggested.complexity)
        ? suggested.complexity as TaskComplexity : undefined;
      const createdTask = await taskApi.createTask({
        projectId: reviewedTask.projectId,
        pipelineId: AGENT_PIPELINE_ID,
        title: suggested.title,
        description: suggested.description,
        type: taskType,
        size: taskSize,
        complexity: taskComplexity,
        debugInfo: suggested.debugInfo || undefined,
        priority,
        tags: ['workflow-review'],
        createdBy: 'workflow-reviewer',
      });
      created++;

      // Send notification with action buttons
      try {
        const isPipelinePhase = (s: string): s is PipelinePhase =>
          (ALL_PIPELINE_PHASES as readonly string[]).includes(s);
        const phase: PipelinePhase = suggested.startPhase && isPipelinePhase(suggested.startPhase)
          ? suggested.startPhase : 'investigating';
        const phaseLabel = PHASE_LABELS[phase];
        const truncatedDesc = suggested.description.length > 200
          ? suggested.description.slice(0, 200) + '...' : suggested.description;
        const notifTitle = 'Workflow Review: New Task';
        const notifChannel = `workflow-review-${createdTask.id}`;
        await taskApi.sendNotificationForTask(createdTask.id, {
          title: notifTitle,
          body: `${suggested.title}\n\n${truncatedDesc}`,
          channel: notifChannel,
          actions: [
            { label: phaseLabel, callbackData: `t|${createdTask.id}|${phase}` },
            { label: '\u274C Close', callbackData: `t|${createdTask.id}|closed` },
            { label: '\u{1F441}\u{FE0F} View', callbackData: `v|${createdTask.id}` },
          ],
        });
      } catch (notifErr) {
        onLog(`Warning: notification failed for suggested task ${createdTask.id}: ${notifErr instanceof Error ? notifErr.message : String(notifErr)}`);
      }
    }

    if (created > 0) {
      onLog(`Created ${created} suggested task(s) from workflow review`);
      await taskApi.logEvent({
        category: 'agent',
        severity: 'info',
        message: `Workflow reviewer suggested ${created} task(s) — auto-created in agent pipeline`,
        data: { createdCount: created, titles: tasks.map(t => t.title) },
      });
    }
  } catch (err) {
    await taskApi.logEvent({
      category: 'agent',
      severity: 'warning',
      message: `Failed to create suggested tasks: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  const _duration = Math.round(performance.now() - _start);
  onPostLog?.('createSuggestedTasks complete', { suggestedCount: tasks.length }, _duration);
}
