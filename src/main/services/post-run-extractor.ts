import type {
  AgentMode,
  AgentRunResult,
  ImplementationPhase,
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
    mode: AgentMode,
    onLog: OnLog,
  ): Promise<void> {
    const isPlanMode = mode === 'plan' || mode === 'plan_revision' || mode === 'plan_resume'
      || mode === 'investigate' || mode === 'investigate_resume';
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
  }

  /**
   * Extract technical design from a successful technical_design run and persist it.
   */
  async extractTechnicalDesign(
    taskId: string,
    result: AgentRunResult,
    mode: AgentMode,
    onLog: OnLog,
  ): Promise<void> {
    const isTdMode = mode === 'technical_design' || mode === 'technical_design_revision' || mode === 'technical_design_resume';
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
  }

  /**
   * Save a context entry for a successful run, capturing summary and metadata.
   */
  async saveContextEntry(
    taskId: string,
    agentRunId: string,
    agentType: string,
    mode: AgentMode,
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
      const entryType = getContextEntryType(agentType, mode, result.outcome);
      onLog(`Saving context entry: type=${entryType}, source=${agentType === 'pr-reviewer' ? 'reviewer' : 'agent'}, summaryLength=${summary.length}`);

      const entryData: Record<string, unknown> = {};
      if (agentType === 'pr-reviewer') {
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
        }
        const wso = result.structuredOutput as WorkflowReviewerOutput | undefined;
        entryData.verdict = wso?.overallVerdict;
        entryData.findings = wso?.findings;
        entryData.promptImprovements = wso?.promptImprovements;
        entryData.processImprovements = wso?.processImprovements;
        entryData.tokenCostAnalysis = wso?.tokenCostAnalysis;
        entryData.executionSummary = wso?.executionSummary;
      }
      const entrySource = agentType === 'pr-reviewer' ? 'reviewer'
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

/** Maps (agentType, mode, outcome) to a context entry type string. */
export function getContextEntryType(agentType: string, mode: AgentMode, outcome?: string): string {
  if (agentType === 'task-workflow-reviewer') return 'workflow_review';
  if (agentType === 'pr-reviewer') return outcome === 'approved' ? 'review_approved' : 'review_feedback';
  switch (mode) {
    case 'plan': return 'plan_summary';
    case 'plan_revision': return 'plan_revision_summary';
    case 'plan_resume': return 'plan_summary';
    case 'investigate': return 'investigation_summary';
    case 'investigate_resume': return 'investigation_summary';
    case 'implement': return 'implementation_summary';
    case 'implement_resume': return 'implementation_summary';
    case 'request_changes': return 'fix_summary';
    case 'resolve_conflicts': return 'conflict_resolution_summary';
    case 'technical_design': return 'technical_design_summary';
    case 'technical_design_revision': return 'technical_design_revision_summary';
    case 'technical_design_resume': return 'technical_design_summary';
    default: return 'agent_output';
  }
}
