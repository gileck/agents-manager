import type {
  AgentRunResult,
  ImplementationPhase,
  RevisionReason,
  Subtask,
  TaskUpdateInput,
} from '../../shared/types';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';

type OnLog = (message: string) => void;

/**
 * Handles post-agent-run data extraction: plan extraction, technical design
 * extraction, context entry saving, and raw-output parsing fallbacks.
 *
 * Extracted from AgentService.runAgentInBackground to reduce method size.
 */
export class PostRunExtractor {
  constructor(
    private taskStore: ITaskStore,
    private taskContextStore: ITaskContextStore,
    private taskEventLog: ITaskEventLog,
  ) {}

  /**
   * Extract plan/subtasks from a successful plan/investigate run and persist them.
   */
  async extractPlan(
    taskId: string,
    result: AgentRunResult,
    agentType: string,
    onLog: OnLog,
    revisionReason?: RevisionReason,
    agentRunId?: string,
  ): Promise<void> {
    const isPlanMode = agentType === 'planner' || agentType === 'investigator';
    if (result.exitCode !== 0 || !isPlanMode) return;

    const so = result.structuredOutput as {
      plan?: string;
      planSummary?: string;
      investigationSummary?: string;
      subtasks?: string[];
      phases?: Array<{ name: string; subtasks: string[] }>;
    } | undefined;

    if (so?.plan) {
      onLog(`Extracting plan from structured output: hasPlan=${!!so.plan}, hasSubtasks=${!!so.subtasks}, subtaskCount=${so.subtasks?.length ?? 0}, hasPhases=${!!so.phases}, phaseCount=${so.phases?.length ?? 0}`);
      const updates: TaskUpdateInput = { plan: so.plan };

      // Check for multi-phase output
      if (so.phases && so.phases.length > 1) {
        const phases: ImplementationPhase[] = so.phases.map((p, idx) => ({
          id: `phase-${idx + 1}`,
          name: p.name,
          status: idx === 0 ? 'in_progress' as const : 'pending' as const,
          subtasks: p.subtasks.map(name => ({ name, status: 'open' as const })),
        }));
        updates.phases = phases;
        updates.subtasks = []; // subtasks live inside phases
        onLog(`Multi-phase plan created with ${phases.length} phases`);
      } else if (so.subtasks && so.subtasks.length > 0) {
        updates.subtasks = so.subtasks.map(name => ({ name, status: 'open' as const }));
      }
      await this.taskStore.updateTask(taskId, updates);
    } else {
      // Fallback: parse raw output if structured output unavailable
      onLog('Structured output unavailable, falling back to raw output parsing');
      await this.taskStore.updateTask(taskId, { plan: this.parseRawPlan(result.output) });
      try {
        const subtasks = this.parseSubtasks(result.output);
        if (subtasks.length > 0) {
          await this.taskStore.updateTask(taskId, { subtasks });
        }
      } catch {
        // Non-fatal
      }
    }

    // After a successful revision, mark all existing plan feedback as addressed
    if (revisionReason === 'changes_requested') {
      if (!agentRunId) {
        onLog('Warning: agentRunId is required to mark plan_feedback as addressed but was not provided');
      } else {
        try {
          await this.markFeedbackAsAddressed(taskId, ['plan_feedback'], agentRunId, onLog);
        } catch (err) {
          onLog(`Warning: failed to mark plan_feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  /**
   * Extract technical design from a successful technical_design run and persist it.
   */
  async extractTechnicalDesign(
    taskId: string,
    result: AgentRunResult,
    agentType: string,
    onLog: OnLog,
    revisionReason?: RevisionReason,
    agentRunId?: string,
  ): Promise<void> {
    const isTdMode = agentType === 'designer';
    if (result.exitCode !== 0 || !isTdMode) return;

    const so = result.structuredOutput as { technicalDesign?: string; designSummary?: string } | undefined;
    if (so?.technicalDesign) {
      onLog(`Extracting technical design from structured output: hasDesign=${!!so.technicalDesign}`);
      await this.taskStore.updateTask(taskId, { technicalDesign: so.technicalDesign });
    } else {
      // Fallback: store raw output as technical design (only if non-empty to avoid overwriting valid design on bad runs)
      const fallback = this.parseRawPlan(result.output);
      if (fallback) {
        await this.taskStore.updateTask(taskId, { technicalDesign: fallback });
      }
    }

    // After a successful revision, mark all existing design feedback as addressed
    if (revisionReason === 'changes_requested') {
      if (!agentRunId) {
        onLog('Warning: agentRunId is required to mark design_feedback as addressed but was not provided');
      } else {
        try {
          await this.markFeedbackAsAddressed(taskId, ['design_feedback'], agentRunId, onLog);
        } catch (err) {
          onLog(`Warning: failed to mark design_feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  /**
   * Save a context entry for a successful run, capturing summary and metadata.
   */
  async saveContextEntry(
    taskId: string,
    agentRunId: string,
    agentType: string,
    revisionReason: RevisionReason | undefined,
    result: AgentRunResult,
    onLog: OnLog,
  ): Promise<void> {
    if (result.exitCode !== 0) return;

    try {
      // Use structured output summary when available, fall back to parsing
      const so = result.structuredOutput as {
        summary?: string;
        planSummary?: string;
        investigationSummary?: string;
        designSummary?: string;
      } | undefined;
      const structuredSummary = so?.investigationSummary ?? so?.designSummary ?? so?.planSummary ?? so?.summary;
      const summary = structuredSummary || this.parseContextSummary(result.output);
      const entryType = getContextEntryType(agentType, revisionReason, result.outcome);
      onLog(`Saving context entry: type=${entryType}, source=${agentType === 'reviewer' ? 'reviewer' : 'agent'}, summaryLength=${summary.length}`);

      const entryData: Record<string, unknown> = {};
      if (agentType === 'reviewer') {
        entryData.verdict = result.outcome;
        if (result.payload?.comments) {
          entryData.comments = result.payload.comments;
        }
      }
      if (agentType === 'task-workflow-reviewer') {
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
      const entrySource = agentType === 'reviewer' ? 'reviewer'
        : agentType === 'task-workflow-reviewer' ? 'workflow-reviewer'
        : 'agent';
      await this.taskContextStore.addEntry({
        taskId, agentRunId,
        source: entrySource,
        entryType, summary, data: entryData,
      });

    } catch (err) {
      // Non-fatal -- don't block pipeline on context entry failure
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'warning',
        message: `Failed to save context entry: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // When implementor addresses reviewer changes, mark implementation_feedback as addressed
    if (agentType === 'implementor' && revisionReason === 'changes_requested') {
      try {
        await this.markFeedbackAsAddressed(taskId, ['implementation_feedback'], agentRunId, onLog);
      } catch (err) {
        onLog(`Warning: failed to mark implementation_feedback as addressed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Create tasks suggested by the workflow reviewer.
   * Each task is created in the agent pipeline under the same project as the reviewed task.
   */
  async createSuggestedTasks(
    taskId: string,
    agentType: string,
    result: AgentRunResult,
    onLog: OnLog,
  ): Promise<void> {
    if (agentType !== 'task-workflow-reviewer' || result.exitCode !== 0) return;

    const wso = result.structuredOutput as {
      suggestedTasks?: Array<{ title: string; description: string; debugInfo?: string; priority?: number }>;
    } | undefined;

    const tasks = wso?.suggestedTasks;
    if (!tasks || tasks.length === 0) return;

    try {
      const reviewedTask = await this.taskStore.getTask(taskId);
      if (!reviewedTask) return;

      const AGENT_PIPELINE_ID = 'pipeline-agent';
      let created = 0;

      for (const suggested of tasks) {
        if (!suggested.title) continue;
        const priority = typeof suggested.priority === 'number' && suggested.priority >= 0 && suggested.priority <= 3
          ? suggested.priority : 2; // default to P2 Medium if not provided or invalid
        await this.taskStore.createTask({
          projectId: reviewedTask.projectId,
          pipelineId: AGENT_PIPELINE_ID,
          title: suggested.title,
          description: suggested.description,
          debugInfo: suggested.debugInfo || undefined,
          priority,
          tags: ['workflow-review'],
        });
        created++;
      }

      if (created > 0) {
        onLog(`Created ${created} suggested task(s) from workflow review`);
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'info',
          message: `Workflow reviewer suggested ${created} task(s) — auto-created in agent pipeline`,
          data: { createdCount: created, titles: tasks.map(t => t.title) },
        });
      }
    } catch (err) {
      // Non-fatal — don't block pipeline on task creation failure
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'warning',
        message: `Failed to create suggested tasks: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ------- Feedback addressing helper -------

  private async markFeedbackAsAddressed(
    taskId: string,
    feedbackTypes: string[],
    agentRunId: string,
    onLog: OnLog,
  ): Promise<void> {
    const count = await this.taskContextStore.markEntriesAsAddressed(taskId, feedbackTypes, agentRunId);
    if (count > 0) {
      onLog(`Marked ${count} feedback entries as addressed (types=${feedbackTypes.join(',')})`);
    }
  }

  // ------- Raw output parsing helpers -------

  private parseRawPlan(output: string): string {
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

  private parseContextSummary(output: string): string {
    const trimmed = output.trimEnd();
    const match = trimmed.match(/## Summary\s*\n([\s\S]+)$/i);
    if (match) return match[1].trim().slice(0, 2000);
    return trimmed.slice(-500).trim();
  }

  private parseSubtasks(output: string): Subtask[] {
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
}

/** Maps (agentType, revisionReason, outcome) to a context entry type string. */
export function getContextEntryType(agentType: string, revisionReason?: RevisionReason, outcome?: string): string {
  if (agentType === 'task-workflow-reviewer') return 'workflow_review';
  if (agentType === 'reviewer') return outcome === 'approved' ? 'review_approved' : 'review_feedback';
  switch (agentType) {
    case 'planner':
      return revisionReason === 'changes_requested' ? 'plan_revision_summary' : 'plan_summary';
    case 'investigator':
      return 'investigation_summary';
    case 'implementor':
      if (revisionReason === 'changes_requested') return 'fix_summary';
      if (revisionReason === 'conflicts_detected') return 'conflict_resolution_summary';
      return 'implementation_summary';
    case 'designer':
      return revisionReason === 'changes_requested' ? 'technical_design_revision_summary' : 'technical_design_summary';
    default:
      console.warn(`getContextEntryType: unexpected agentType '${agentType}', using 'agent_output'`);
      return 'agent_output';
  }
}
