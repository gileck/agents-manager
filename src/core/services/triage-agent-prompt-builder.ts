import { TRIAGE_ENTRY_TYPE } from '../../shared/types';
import type { AutomatedAgent, Project, Task } from '../../shared/types';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { IAutomatedAgentPromptBuilder } from '../interfaces/automated-agent-prompt-builder';

export class TriageAgentPromptBuilder implements IAutomatedAgentPromptBuilder {
  readonly templateId = 'task-triage';

  constructor(
    private taskStore: ITaskStore,
    private taskContextStore: ITaskContextStore,
  ) {}

  async buildContext(agent: AutomatedAgent, project: Project): Promise<string> {
    const tasks = await this.taskStore.listTasks({ projectId: project.id, status: 'open' });

    // Filter out already-triaged tasks (those with a triage_summary context entry)
    const untriaged: Task[] = [];
    for (const task of tasks) {
      const entries = await this.taskContextStore.getEntriesForTask(task.id);
      const hasTriageSummary = entries.some(e => e.entryType === TRIAGE_ENTRY_TYPE);
      if (!hasTriageSummary) {
        untriaged.push(task);
      }
    }

    if (untriaged.length === 0) {
      return [
        '## Task to Triage',
        '',
        'No untriaged open tasks found. All open tasks have already been triaged.',
      ].join('\n');
    }

    // Sort by priority (0 = critical first), then by creation time (oldest first)
    untriaged.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);

    const task = untriaged[0];
    const lines: string[] = [
      '## Task to Triage',
      '',
      `Untriaged open tasks remaining: ${untriaged.length}`,
      '',
      `### [${task.id}] ${task.title}`,
      `- Priority: ${task.priority}`,
      `- Current type: ${task.type}`,
      `- Size: ${task.size ?? 'not set'}`,
      `- Complexity: ${task.complexity ?? 'not set'}`,
      `- Description: ${task.description ?? '(no description)'}`,
    ];

    if (task.debugInfo) {
      lines.push(`- Debug info: ${task.debugInfo}`);
    }

    return lines.join('\n');
  }

  getOutputFormat(): object {
    return {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID that was triaged' },
          type: { type: 'string', enum: ['bug', 'feature', 'chore', 'refactor', 'docs', 'test'] },
          size: { type: 'string', enum: ['xs', 'sm', 'md', 'lg', 'xl'] },
          complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
          route: { type: 'string', description: 'Target pipeline stage (e.g. investigating, designing, planning, implementing)' },
          summary: { type: 'string', description: 'One-line triage summary' },
          skipped: { type: 'boolean', description: 'True if no untriaged tasks were found' },
        },
        required: ['summary', 'skipped'],
      },
    };
  }
}
