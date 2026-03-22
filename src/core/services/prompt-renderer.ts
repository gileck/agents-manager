import type { AgentContext } from '../../shared/types';
import { formatCommentsForPrompt, formatFeedbackForPrompt } from '../agents/prompt-utils';
import { findDoc } from '../agents/doc-injection';

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
      '{technicalDesignSection}': this.buildTechnicalDesignSection(context),
      '{technicalDesignCommentsSection}': this.buildTechnicalDesignCommentsSection(context),
      '{defaultBranch}': this.buildDefaultBranch(context),
      '{skillsSection}': this.buildSkillsSection(context),
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
    const { task } = context;

    if (context.task.status === 'planning' || context.task.status === 'investigating') {
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
      const lines = [
        '',
        '## IMPORTANT: Subtask Progress Tracking',
        'Create a todo list with the following subtasks and update their status as you work through them:',
        '',
      ];
      for (const st of task.subtasks) {
        lines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
      }
      return lines.join('\n');
    }

    return '';
  }

  private buildPlanSection(context: AgentContext): string {
    const planDoc = findDoc(context.docs, 'plan');
    if (planDoc?.content) {
      return `\n## Plan\n${planDoc.content}`;
    }
    return '';
  }

  private buildPlanCommentsSection(context: AgentContext): string {
    if (context.taskContext?.some(e => e.entryType === 'plan_feedback')) {
      return formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback').join('\n');
    }
    return formatCommentsForPrompt(context.task.planComments, 'Admin Feedback').join('\n');
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
        `  npx agents-manager tasks get ${relatedTaskId} --json`,
        `  npx agents-manager events list --task ${relatedTaskId} --json`,
      ].join('\n');
    }
    return '';
  }

  private buildTechnicalDesignSection(context: AgentContext): string {
    const designDoc = findDoc(context.docs, 'technical_design');
    if (designDoc?.content) {
      return `\n## Technical Design\n${designDoc.content}`;
    }
    return '';
  }

  private buildTechnicalDesignCommentsSection(context: AgentContext): string {
    if (context.taskContext?.some(e => e.entryType === 'design_feedback')) {
      return formatFeedbackForPrompt(context.taskContext, ['design_feedback'], 'Admin Feedback on Design').join('\n');
    }
    return formatCommentsForPrompt(context.task.technicalDesignComments, 'Admin Feedback on Design').join('\n');
  }

  private buildDefaultBranch(context: AgentContext): string {
    return (context.project.config?.defaultBranch as string) || 'main';
  }

  private buildSkillsSection(context: AgentContext): string {
    if (context.skills && context.skills.length > 0) {
      const lines = ['', '## Available Skills', 'You have access to the following skills. Use the Skill tool to invoke them:'];
      for (const skill of context.skills) {
        lines.push(`- /${skill}`);
      }
      return lines.join('\n');
    }
    return '';
  }
}
