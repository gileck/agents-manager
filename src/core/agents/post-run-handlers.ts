import type { PostRunHandler } from './post-run-handler';
import { plannerPostRunHandler } from './planner-post-run-handler';
import { investigatorPostRunHandler } from './investigator-post-run-handler';
import { designerPostRunHandler } from './designer-post-run-handler';
import { uxDesignerPostRunHandler } from './ux-designer-post-run-handler';
import { implementorPostRunHandler } from './implementor-post-run-handler';
import { reviewerPostRunHandler } from './reviewer-post-run-handler';
import { triagerPostRunHandler } from './triager-post-run-handler';
import { taskWorkflowReviewerPostRunHandler } from './task-workflow-reviewer-post-run-handler';
import { postMortemReviewerPostRunHandler } from './post-mortem-reviewer-post-run-handler';

/**
 * Declarative map of agent type → post-run handler function.
 *
 * Each handler is colocated with its prompt builder and is the single
 * authority on how that agent's structured output maps to persistence.
 *
 * Adding a new agent = add one entry here (mirrors AGENT_BUILDERS pattern).
 */
export const POST_RUN_HANDLERS: Record<string, PostRunHandler> = {
  'planner': plannerPostRunHandler,
  'investigator': investigatorPostRunHandler,
  'designer': designerPostRunHandler,
  'ux-designer': uxDesignerPostRunHandler,
  'implementor': implementorPostRunHandler,
  'reviewer': reviewerPostRunHandler,
  'triager': triagerPostRunHandler,
  'task-workflow-reviewer': taskWorkflowReviewerPostRunHandler,
  'post-mortem-reviewer': postMortemReviewerPostRunHandler,
};
