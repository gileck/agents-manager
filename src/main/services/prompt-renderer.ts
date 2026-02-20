import type { AgentContext } from '../../shared/types';

export class PromptRenderer {
  render(template: string, context: AgentContext): string {
    const variables: Record<string, string> = {
      '{taskTitle}': this.buildTaskTitle(context),
      '{taskDescription}': this.buildTaskDescription(context),
      '{taskId}': context.task.id,
      '{subtasksSection}': this.buildSubtasksSection(context),
      '{planSection}': this.buildPlanSection(context),
      '{planCommentsSection}': this.buildPlanCommentsSection(context),
      '{priorReviewSection}': this.buildPriorReviewSection(context),
      '{relatedTaskSection}': this.buildRelatedTaskSection(context),
      '{defaultBranch}': this.buildDefaultBranch(context),
      '{skipSummary}': '',
    };

    // Use replacer functions to avoid $-pattern interpretation in replacement strings
    let prompt = template;
    for (const [key, value] of Object.entries(variables)) {
      prompt = prompt.replaceAll(key, value);
    }

    // Append standard suffix only when template does not opt out via {skipSummary}
    if (!template.includes('{skipSummary}')) {
      prompt += '\n\nWhen you are done, end your response with a "## Summary" section that briefly describes what you did.';
    }

    // Append validation errors if present
    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  private buildTaskTitle(context: AgentContext): string {
    return context.task.title;
  }

  private buildTaskDescription(context: AgentContext): string {
    return context.task.description ? ` ${context.task.description}` : '';
  }

  private buildSubtasksSection(context: AgentContext): string {
    const { task, mode } = context;

    if (mode === 'plan' || mode === 'investigate') {
      return [
        '',
        'At the end of your plan, include a "## Subtasks" section with a JSON array of subtask names that break down the implementation into concrete steps. Example:',
        '## Subtasks',
        '```json',
        '["Set up database schema", "Implement API endpoint", "Add unit tests"]',
        '```',
      ].join('\n');
    }

    if (task.subtasks && task.subtasks.length > 0) {
      const lines = ['', '## Subtasks', 'Track your progress by updating subtask status as you work:'];
      for (const st of task.subtasks) {
        lines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
      }
      lines.push(
        '',
        'Use the CLI to update subtask status as you complete each step:',
        `  am tasks subtask update ${task.id} --name "subtask name" --status in_progress`,
        `  am tasks subtask update ${task.id} --name "subtask name" --status done`,
      );
      return lines.join('\n');
    }

    return '';
  }

  private buildPlanSection(context: AgentContext): string {
    if (context.task.plan) {
      return `\n## Plan\n${context.task.plan}`;
    }
    return '';
  }

  private buildPlanCommentsSection(context: AgentContext): string {
    const { task } = context;
    if (task.planComments && task.planComments.length > 0) {
      const lines = ['', '## Admin Feedback'];
      for (const comment of task.planComments) {
        const time = new Date(comment.createdAt).toLocaleString();
        lines.push(`- **${comment.author}** (${time}): ${comment.content}`);
      }
      return lines.join('\n');
    }
    return '';
  }

  private buildPriorReviewSection(context: AgentContext): string {
    const hasPriorReview = context.taskContext?.some(
      e => e.entryType === 'review_feedback' || e.entryType === 'fix_summary'
    );
    if (hasPriorReview) {
      return [
        'This is a RE-REVIEW. Previous review feedback and fixes are in the Task Context above.',
        'Verify ALL previously requested changes were addressed before approving.',
        '',
      ].join('\n');
    }
    return '';
  }

  private buildRelatedTaskSection(context: AgentContext): string {
    const relatedTaskId = context.task.metadata?.relatedTaskId as string | undefined;
    if (relatedTaskId) {
      return [
        '',
        '## Related Task',
        `This bug references task \`${relatedTaskId}\`. Use the CLI to inspect it:`,
        `  am tasks get ${relatedTaskId} --json`,
        `  am events list --task ${relatedTaskId} --json`,
      ].join('\n');
    }
    return '';
  }

  private buildDefaultBranch(context: AgentContext): string {
    return (context.project.config?.defaultBranch as string) || 'main';
  }
}
