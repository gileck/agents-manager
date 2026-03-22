// ─── Config type ──────────────────────────────────────────────────────────────

import { DOC_PHASES } from '../../shared/doc-phases';
import type { DocArtifactType } from '../../shared/types';

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
    | { type: 'taskDoc'; docType: DocArtifactType }
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

export const REPORT_CONFIGS: Record<string, ReportPageConfig> = {};

// Generate configs from DOC_PHASES registry
for (const phase of DOC_PHASES) {
  // Map docType to route key used in the URL
  const routeKey = phase.docType === 'investigation_report' ? 'investigation'
    : phase.docType === 'technical_design' ? 'design'
    : 'plan';

  REPORT_CONFIGS[routeKey] = {
    label: phase.docTitle,
    tabLabel: `${phase.docTitle} Review`,
    tabKey: routeKey,
    contentSource: { type: 'taskDoc', docType: phase.docType },
    renderer: 'markdown',
    agentRole: phase.agentType,
    entryType: phase.feedbackType,
    chatPlaceholder: `Ask about the ${phase.docTitle.toLowerCase()} or request changes...`,
    chatStorageKey: `${phase.docType}Review.chatOpen`,
    approveToStatus: 'implementing',
    reviseToStatus: phase.activeStatus,
    reviewStatus: phase.reviewStatus,
    emptyMessage: `No ${phase.docTitle.toLowerCase()} content available yet.`,
  };
}

// Non-doc report configs
REPORT_CONFIGS['post-mortem'] = {
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
};

REPORT_CONFIGS['workflow-review'] = {
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
};
