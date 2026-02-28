import type { ModePromptDef } from './shared';

import { planPrompt, planRevisionPrompt, planResumePrompt } from './plan';
import { implementPrompt, implementResumePrompt } from './implement';
import { investigatePrompt, investigateResumePrompt } from './investigate';
import { technicalDesignPrompt, technicalDesignRevisionPrompt, technicalDesignResumePrompt } from './technical-design';
import { requestChangesPrompt } from './request-changes-prompt';
import { resolveConflictsPrompt } from './resolve-conflicts-prompt';

export type { ModePromptDef, ModePromptConfig } from './shared';
export { getInteractiveInstructions } from './shared';

/**
 * Registry of all implementor mode prompts.
 * The ImplementorPromptBuilder delegates to these definitions.
 */
export const modePrompts: Record<string, ModePromptDef> = {
  plan: planPrompt,
  plan_revision: planRevisionPrompt,
  plan_resume: planResumePrompt,
  implement: implementPrompt,
  implement_resume: implementResumePrompt,
  investigate: investigatePrompt,
  investigate_resume: investigateResumePrompt,
  technical_design: technicalDesignPrompt,
  technical_design_revision: technicalDesignRevisionPrompt,
  technical_design_resume: technicalDesignResumePrompt,
  request_changes: requestChangesPrompt,
  resolve_conflicts: resolveConflictsPrompt,
};
