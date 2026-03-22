import type { DocArtifactType } from './types';

/**
 * Central registry mapping the 1:1:1:1 relationship between
 * agent types, document types, pipeline states, and feedback types.
 *
 * Adding a new document type requires only a new enum value in
 * DocArtifactType and a new entry here — zero schema migrations.
 */
export interface DocPhaseEntry {
  agentType: string;
  docType: DocArtifactType;
  docTitle: string;
  activeStatus: string;
  reviewStatus: string;
  feedbackType: string;
  /** Route key used in the UI URL path (e.g. /tasks/:id/:routeKey). */
  routeKey: string;
}

export const DOC_PHASES: readonly DocPhaseEntry[] = [
  {
    agentType: 'investigator',
    docType: 'investigation_report',
    docTitle: 'Investigation Report',
    activeStatus: 'investigating',
    reviewStatus: 'investigation_review',
    feedbackType: 'investigation_feedback',
    routeKey: 'investigation',
  },
  {
    agentType: 'planner',
    docType: 'plan',
    docTitle: 'Plan',
    activeStatus: 'planning',
    reviewStatus: 'plan_review',
    feedbackType: 'plan_feedback',
    routeKey: 'plan',
  },
  {
    agentType: 'designer',
    docType: 'technical_design',
    docTitle: 'Technical Design',
    activeStatus: 'designing',
    reviewStatus: 'design_review',
    feedbackType: 'design_feedback',
    routeKey: 'design',
  },
] as const;

// --- Lookup helpers ---

export function getPhaseByAgentType(agentType: string): DocPhaseEntry | undefined {
  return DOC_PHASES.find(p => p.agentType === agentType);
}

export function getPhaseByDocType(docType: DocArtifactType): DocPhaseEntry | undefined {
  return DOC_PHASES.find(p => p.docType === docType);
}

export function getPhaseByReviewStatus(status: string): DocPhaseEntry | undefined {
  return DOC_PHASES.find(p => p.reviewStatus === status);
}

export function getPhaseByActiveStatus(status: string): DocPhaseEntry | undefined {
  return DOC_PHASES.find(p => p.activeStatus === status);
}

export function getPhaseByFeedbackType(feedbackType: string): DocPhaseEntry | undefined {
  return DOC_PHASES.find(p => p.feedbackType === feedbackType);
}

export function getDocTypeForAgent(agentType: string): DocArtifactType | undefined {
  return getPhaseByAgentType(agentType)?.docType;
}

export function getFeedbackTypeForAgent(agentType: string): string | undefined {
  return getPhaseByAgentType(agentType)?.feedbackType;
}

export function getRouteKeyForDocType(docType: DocArtifactType): string | undefined {
  return getPhaseByDocType(docType)?.routeKey;
}
