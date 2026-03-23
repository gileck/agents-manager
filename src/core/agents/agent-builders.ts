import type { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { PlannerPromptBuilder } from './planner-prompt-builder';
import { DesignerPromptBuilder } from './designer-prompt-builder';
import { ImplementorPromptBuilder } from './implementor-prompt-builder';
import { InvestigatorPromptBuilder } from './investigator-prompt-builder';
import { ReviewerPromptBuilder } from './reviewer-prompt-builder';
import { TaskWorkflowReviewerPromptBuilder } from './task-workflow-reviewer-prompt-builder';
import { PostMortemReviewerPromptBuilder } from './post-mortem-reviewer-prompt-builder';
import { TriagerPromptBuilder } from './triager-prompt-builder';
import { UxDesignerPromptBuilder } from './ux-designer-prompt-builder';

/**
 * Declarative map of agent type → prompt builder class.
 * Adding a new agent = add one entry here. No scattered imports needed.
 */
export const AGENT_BUILDERS: Record<string, new () => BaseAgentPromptBuilder> = {
  'planner': PlannerPromptBuilder,
  'designer': DesignerPromptBuilder,
  'implementor': ImplementorPromptBuilder,
  'investigator': InvestigatorPromptBuilder,
  'reviewer': ReviewerPromptBuilder,
  'task-workflow-reviewer': TaskWorkflowReviewerPromptBuilder,
  'post-mortem-reviewer': PostMortemReviewerPromptBuilder,
  'triager': TriagerPromptBuilder,
  'ux-designer': UxDesignerPromptBuilder,
};
