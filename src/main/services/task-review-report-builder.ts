import * as fs from 'fs/promises';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { TimelineService } from './timeline/timeline-service';

export class TaskReviewReportBuilder {
  constructor(
    private agentRunStore: IAgentRunStore,
    private taskEventLog: ITaskEventLog,
    private taskContextStore: ITaskContextStore,
    private taskArtifactStore: ITaskArtifactStore,
    private taskStore: ITaskStore,
    private timelineService: TimelineService,
  ) {}

  async buildReport(taskId: string, outputPath: string): Promise<void> {
    const lines: string[] = [];

    // Fetch all data in parallel
    const [task, agentRuns, events, contextEntries, artifacts, timeline] = await Promise.all([
      this.taskStore.getTask(taskId),
      this.agentRunStore.getRunsForTask(taskId),
      this.taskEventLog.getEvents({ taskId }),
      this.taskContextStore.getEntriesForTask(taskId),
      this.taskArtifactStore.getArtifactsForTask(taskId),
      Promise.resolve(this.timelineService.getTimeline(taskId)),
    ]);

    if (!task) {
      await fs.writeFile(outputPath, `Task not found: ${taskId}`, 'utf-8');
      return;
    }

    // ── SUMMARY ──
    const totalInputTokens = agentRuns.reduce((s, r) => s + (r.costInputTokens ?? 0), 0);
    const totalOutputTokens = agentRuns.reduce((s, r) => s + (r.costOutputTokens ?? 0), 0);
    const retries = agentRuns.filter(r => r.outcome === 'failed' && r.status === 'completed').length;
    const failures = agentRuns.filter(r => r.status === 'failed').length;

    const transitions = timeline.filter(e => e.source === 'transition').sort((a, b) => a.timestamp - b.timestamp);
    const firstTs = task.createdAt;
    const lastTs = transitions.length > 0 ? transitions[transitions.length - 1].timestamp : task.updatedAt;
    const totalDuration = this.formatDuration(lastTs - firstTs);

    lines.push(`[[ SUMMARY:START ]]`);
    lines.push(`Task: ${task.title}`);
    lines.push(`Description: ${task.description ?? 'N/A'}`);
    lines.push(`Status: ${task.status}`);
    lines.push(`Created: ${new Date(firstTs).toISOString()}`);
    lines.push(`Completed: ${new Date(lastTs).toISOString()}`);
    lines.push(`Total Duration: ${totalDuration}`);
    lines.push(`Total Agent Runs: ${agentRuns.length}`);
    lines.push(`Total Token Cost: ${totalInputTokens} input / ${totalOutputTokens} output`);
    lines.push(`Retries: ${retries}`);
    lines.push(`Failures: ${failures}`);
    lines.push(``);
    lines.push(`Timeline:`);
    for (const t of transitions) {
      const ts = new Date(t.timestamp).toISOString().split('T')[1].split('.')[0];
      lines.push(`  ${ts} ${t.title}`);
    }

    if (task.plan) {
      lines.push(``);
      lines.push(`Plan:`);
      lines.push(task.plan);
    }

    if (task.subtasks && task.subtasks.length > 0) {
      lines.push(``);
      lines.push(`Subtasks:`);
      for (const st of task.subtasks) {
        lines.push(`- [${st.status}] ${st.name}`);
      }
    }
    lines.push(`[[ SUMMARY:END ]]`);
    lines.push(``);

    // ── AGENT RUNS ──
    lines.push(`[[ AGENT_RUNS:START count=${agentRuns.length} ]]`);
    lines.push(``);

    for (const run of agentRuns) {
      const duration = run.completedAt ? this.formatDuration(run.completedAt - run.startedAt) : 'running';
      lines.push(`[[ AGENT_RUN:START id=${run.id} type=${run.agentType} mode=${run.mode} status=${run.status} duration=${duration} tokens_in=${run.costInputTokens ?? 0} tokens_out=${run.costOutputTokens ?? 0} outcome=${run.outcome ?? 'none'} ]]`);
      lines.push(``);

      if (run.prompt) {
        lines.push(`[[ AGENT_RUN_PROMPT:START id=${run.id} ]]`);
        lines.push(run.prompt);
        lines.push(`[[ AGENT_RUN_PROMPT:END id=${run.id} ]]`);
        lines.push(``);
      }

      if (run.output) {
        lines.push(`[[ AGENT_RUN_OUTPUT:START id=${run.id} ]]`);
        lines.push(run.output);
        lines.push(`[[ AGENT_RUN_OUTPUT:END id=${run.id} ]]`);
        lines.push(``);
      }

      lines.push(`[[ AGENT_RUN:END id=${run.id} ]]`);
      lines.push(``);
    }

    lines.push(`[[ AGENT_RUNS:END ]]`);
    lines.push(``);

    // ── EVENTS ──
    lines.push(`[[ EVENTS:START count=${events.length} ]]`);
    for (const evt of events) {
      lines.push(`[[ EVENT ts=${evt.createdAt} category=${evt.category} severity=${evt.severity} ]] ${evt.message}`);
    }
    lines.push(`[[ EVENTS:END ]]`);
    lines.push(``);

    // ── TRANSITIONS ──
    lines.push(`[[ TRANSITIONS:START count=${transitions.length} ]]`);
    for (const t of transitions) {
      const trigger = t.data?.trigger ?? 'unknown';
      lines.push(`[[ TRANSITION ts=${t.timestamp} trigger=${trigger} ]] ${t.title}`);
      if (t.data) {
        const dataStr = JSON.stringify(t.data);
        if (dataStr.length > 2) {
          lines.push(`  Data: ${dataStr}`);
        }
      }
    }
    lines.push(`[[ TRANSITIONS:END ]]`);
    lines.push(``);

    // ── HOOKS ──
    const hookEntries = timeline.filter(e => e.data?.hookName);
    lines.push(`[[ HOOKS:START ]]`);
    for (const h of hookEntries) {
      const hookName = h.data?.hookName ?? 'unknown';
      const result = h.severity === 'error' ? 'failed' : 'success';
      lines.push(`[[ HOOK:START name=${hookName} result=${result} ]]`);
      lines.push(h.title);
      if (h.data) {
        lines.push(`Data: ${JSON.stringify(h.data)}`);
      }
      lines.push(`[[ HOOK:END name=${hookName} ]]`);
    }
    lines.push(`[[ HOOKS:END ]]`);
    lines.push(``);

    // ── ARTIFACTS ──
    lines.push(`[[ ARTIFACTS:START count=${artifacts.length} ]]`);
    for (const a of artifacts) {
      const dataStr = JSON.stringify(a.data);
      if (a.type === 'diff' && a.data?.content) {
        lines.push(`[[ ARTIFACT type=diff ]]`);
        lines.push(String(a.data.content));
        lines.push(`[[ ARTIFACT:END type=diff ]]`);
      } else {
        lines.push(`[[ ARTIFACT type=${a.type} ]] ${dataStr}`);
      }
    }
    lines.push(`[[ ARTIFACTS:END ]]`);
    lines.push(``);

    // ── CONTEXT ENTRIES ──
    lines.push(`[[ CONTEXT_ENTRIES:START count=${contextEntries.length} ]]`);
    for (const entry of contextEntries) {
      lines.push(`[[ CONTEXT_ENTRY:START type=${entry.entryType} source=${entry.source} run=${entry.agentRunId ?? 'none'} ]]`);
      lines.push(entry.summary);
      lines.push(`[[ CONTEXT_ENTRY:END ]]`);
    }
    lines.push(`[[ CONTEXT_ENTRIES:END ]]`);

    await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
  }

  private formatDuration(ms: number): string {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    if (mins < 60) return `${mins}m${remSecs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h${remMins}m`;
  }
}
