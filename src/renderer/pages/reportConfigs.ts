// ─── Config type ──────────────────────────────────────────────────────────────

export type ReportRenderer = 'markdown' | 'post-mortem' | 'workflow-review';

export interface ReportPageConfig {
  /** Display label (e.g. "Plan", "Post-Mortem Report") */
  label: string;
  /** Label shown in the TaskSubPageLayout header breadcrumb */
  tabLabel: string;
  /** localStorage tab restore key */
  tabKey: string;

  /** Where to read the report content from */
  contentSource:
    | { type: 'taskField'; field: 'plan' | 'technicalDesign' | 'investigationReport' | 'postMortem' }
    | { type: 'contextEntry'; entryType: string };

  /** Which renderer to use for the left-panel content */
  renderer: ReportRenderer;

  /** Agent role for chat session (must be in VALID_AGENT_ROLES on the backend) */
  agentRole: string;
  /** Entry type for chat feedback entries */
  entryType: string;
  /** Placeholder text for the chat input */
  chatPlaceholder: string;

  /** localStorage key for persisting chat panel open/close state */
  chatStorageKey: string;

  /** Optional: target status for "approve" transition */
  approveToStatus?: string;
  /** Optional: target status for "revise/request changes" transition */
  reviseToStatus?: string;
  /** Optional: task status that means "in review" — enables action buttons */
  reviewStatus?: string;

  /** Empty state message when no content is available */
  emptyMessage: string;
}

// ─── Config map ───────────────────────────────────────────────────────────────

export const REPORT_CONFIGS: Record<string, ReportPageConfig> = {
  plan: {
    label: 'Plan',
    tabLabel: 'Plan Review',
    tabKey: 'plan',
    contentSource: { type: 'taskField', field: 'plan' },
    renderer: 'markdown',
    agentRole: 'planner',
    entryType: 'plan_feedback',
    chatPlaceholder: 'Ask about the plan or request changes...',
    chatStorageKey: 'planReview.chatOpen',
    approveToStatus: 'implementing',
    reviseToStatus: 'planning',
    reviewStatus: 'plan_review',
    emptyMessage: 'No plan content available yet.',
  },
  design: {
    label: 'Technical Design',
    tabLabel: 'Technical Design Review',
    tabKey: 'design',
    contentSource: { type: 'taskField', field: 'technicalDesign' },
    renderer: 'markdown',
    agentRole: 'designer',
    entryType: 'design_feedback',
    chatPlaceholder: 'Ask about the technical design or request changes...',
    chatStorageKey: 'designReview.chatOpen',
    approveToStatus: 'implementing',
    reviseToStatus: 'designing',
    reviewStatus: 'design_review',
    emptyMessage: 'No technical design content available yet.',
  },
  investigation: {
    label: 'Investigation Report',
    tabLabel: 'Investigation Report Review',
    tabKey: 'investigation',
    contentSource: { type: 'taskField', field: 'investigationReport' },
    renderer: 'markdown',
    agentRole: 'investigator',
    entryType: 'investigation_feedback',
    chatPlaceholder: 'Ask about the investigation report or request changes...',
    chatStorageKey: 'investigationReview.chatOpen',
    approveToStatus: 'implementing',
    reviseToStatus: 'investigating',
    reviewStatus: 'investigation_review',
    emptyMessage: 'No investigation report content available yet.',
  },
  'post-mortem': {
    label: 'Post-Mortem Report',
    tabLabel: 'Post-Mortem Report',
    tabKey: 'post-mortem',
    contentSource: { type: 'taskField', field: 'postMortem' },
    renderer: 'post-mortem',
    agentRole: 'post-mortem-reviewer',
    entryType: 'post_mortem_feedback',
    chatPlaceholder: 'Ask about the post-mortem findings...',
    chatStorageKey: 'postMortemReview.chatOpen',
    emptyMessage: 'No post-mortem analysis available yet.',
  },
  'workflow-review': {
    label: 'Workflow Review',
    tabLabel: 'Workflow Review',
    tabKey: 'workflow-review',
    contentSource: { type: 'contextEntry', entryType: 'workflow_review' },
    renderer: 'workflow-review',
    agentRole: 'workflow-reviewer',
    entryType: 'workflow_review_feedback',
    chatPlaceholder: 'Ask about the workflow review findings...',
    chatStorageKey: 'workflowReview.chatOpen',
    emptyMessage: 'No workflow review available yet.',
  },
};
