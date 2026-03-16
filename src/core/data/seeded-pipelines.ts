import type { PipelineStatus, Transition, TransitionHook } from '../../shared/types';

export interface SeededPipeline {
  id: string;
  name: string;
  description: string;
  taskType: string;
  statuses: PipelineStatus[];
  transitions: Transition[];
}

// ── Agent Phase Data Table ─────────────────────────────────────────────
// Cross-cutting transitions (start, complete, needs-info, retry, cancel)
// are generated from this table rather than hand-written per phase.

interface AgentPhase {
  status: string;
  agentType: string;
  reviewStatus: string;
  completionOutcome: string;
  label: string;
  /** Override default completion hooks (notify only). When set, these hooks are used instead. */
  completionHooks?: TransitionHook[];
}

const PHASES: AgentPhase[] = [
  { status: 'investigating', agentType: 'investigator', reviewStatus: 'investigation_review', completionOutcome: 'investigation_complete', label: 'Investigation' },
  { status: 'designing',     agentType: 'designer',     reviewStatus: 'design_review',        completionOutcome: 'design_ready',           label: 'Tech Design' },
  { status: 'planning',      agentType: 'planner',      reviewStatus: 'plan_review',          completionOutcome: 'plan_complete',           label: 'Planning' },
  { status: 'implementing',  agentType: 'implementor',  reviewStatus: 'pr_review',            completionOutcome: 'pr_ready',                label: 'Implementation',
    completionHooks: [
      { name: 'push_and_create_pr', policy: 'required' },
      notify('PR ready', 'PR ready: {taskTitle}\n\nSummary: {summary}'),
      startAgent('reviewer', 'new'),
    ] },
];

// ── Hook Helpers ───────────────────────────────────────────────────────

function startAgent(agentType: string, mode: 'new' | 'revision', revisionReason?: string): TransitionHook {
  const params: Record<string, string> = { mode, agentType };
  if (revisionReason) params.revisionReason = revisionReason;
  return { name: 'start_agent', params, policy: 'fire_and_forget' };
}

function notify(title: string, body: string): TransitionHook {
  return { name: 'notify', params: { titleTemplate: title, bodyTemplate: body }, policy: 'best_effort' };
}

// ── Per-Phase Pattern Generators ───────────────────────────────────────
// Each function generates one cross-cutting transition pattern for a phase.

/** open → phase (manual start) */
function startFromOpen(p: AgentPhase): Transition {
  return {
    from: 'open', to: p.status, trigger: 'manual', label: `Start ${p.label}`,
    guards: [{ name: 'no_running_agent' }],
    hooks: [startAgent(p.agentType, 'new')],
  };
}

/** phase → reviewStatus (agent completes successfully) */
function completion(p: AgentPhase): Transition {
  const hooks = p.completionHooks ?? [
    notify(`${p.label} ready`, `${p.label} ready: {taskTitle}\n\nSummary: {summary}`),
  ];
  return {
    from: p.status, to: p.reviewStatus, trigger: 'agent', agentOutcome: p.completionOutcome,
    hooks,
  };
}

/** phase → needs_info (agent requests human input) */
function needsInfo(p: AgentPhase): Transition {
  return {
    from: p.status, to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
    hooks: [
      { name: 'create_prompt', params: { resumeOutcome: 'info_provided' }, policy: 'required' },
      notify('Info needed', 'Info needed: {taskTitle}'),
    ],
  };
}

/** needs_info → phase (human provides info, agent resumes) */
function infoProvided(p: AgentPhase): Transition {
  return {
    from: 'needs_info', to: p.status, trigger: 'agent', agentOutcome: 'info_provided',
    hooks: [startAgent(p.agentType, 'revision', 'info_provided')],
  };
}

/** phase → phase self-loop (auto-retry on failure, max 3) */
function autoRetry(p: AgentPhase): Transition {
  return {
    from: p.status, to: p.status, trigger: 'agent', agentOutcome: 'failed',
    guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
    hooks: [startAgent(p.agentType, 'new')],
  };
}

/** phase → open (manual cancel) */
function cancelPhase(p: AgentPhase): Transition {
  return { from: p.status, to: 'open', trigger: 'manual', label: `Cancel ${p.label}` };
}

// ── Generate all cross-cutting transitions ─────────────────────────────

const perPhaseTransitions: Transition[] = PHASES.flatMap(p => [
  startFromOpen(p),
  completion(p),
  needsInfo(p),
  infoProvided(p),
  autoRetry(p),
  cancelPhase(p),
]);

// ── Multi-Phase PR Approve ─────────────────────────────────────────────
// Three guarded variants handle intermediate phases, last phase, and
// single-phase. Both manual and agent triggers share the same structure.

function prApprove(trigger: 'manual' | 'agent'): Transition[] {
  const outcome = trigger === 'agent' ? { agentOutcome: 'approved' } : {};
  const lbl = trigger === 'manual' ? { label: 'Approve' } : {};
  return [
    // Intermediate phase: merge and cycle to next phase
    { from: 'pr_review', to: 'done', trigger, ...outcome, ...lbl,
      guards: [{ name: 'has_following_phases' }],
      hooks: [{ name: 'merge_pr', policy: 'required' }, { name: 'advance_phase', policy: 'best_effort' }] },
    // Last phase: merge, create final PR, notify
    { from: 'pr_review', to: 'ready_to_merge', trigger, ...outcome, ...lbl,
      guards: [{ name: 'has_pending_phases' }],
      hooks: [
        { name: 'merge_pr', policy: 'required' },
        { name: 'advance_phase', policy: 'best_effort' },
        notify('Final PR ready to merge', 'All phases complete. Final integration PR ready to merge: {taskTitle}'),
      ] },
    // Single-phase: straight to ready_to_merge
    { from: 'pr_review', to: 'ready_to_merge', trigger, ...outcome, ...lbl,
      hooks: [notify('PR approved', 'PR approved: {taskTitle}')] },
  ];
}

// ── Pipeline Definition ────────────────────────────────────────────────

export const AGENT_PIPELINE: SeededPipeline = {
  id: 'pipeline-agent',
  name: 'Agent-Driven',
  description: 'Agent-driven workflow with investigation, tech design, plan, implement, and review phases',
  taskType: 'agent',
  statuses: [
    { name: 'open', label: 'Open', color: '#3b82f6', category: 'ready', position: 0 },
    { name: 'backlog', label: 'Backlog', color: '#94a3b8', category: 'ready' },
    { name: 'investigating', label: 'Investigating', color: '#f59e0b', category: 'agent_running', position: 1 },
    { name: 'investigation_review', label: 'Investigation Review', color: '#8b5cf6', category: 'human_review', position: 2 },
    { name: 'designing', label: 'Designing', color: '#ec4899', category: 'agent_running', position: 3 },
    { name: 'design_review', label: 'Design Review', color: '#a855f7', category: 'human_review', position: 4 },
    { name: 'planning', label: 'Planning', color: '#f97316', category: 'agent_running', position: 5 },
    { name: 'plan_review', label: 'Plan Review', color: '#ef4444', category: 'human_review', position: 6 },
    { name: 'implementing', label: 'Implementing', color: '#0ea5e9', category: 'agent_running', position: 7 },
    { name: 'pr_review', label: 'PR Review', color: '#6366f1', category: 'human_review', position: 8 },
    { name: 'ready_to_merge', label: 'Ready to Merge', color: '#14b8a6', category: 'human_review', position: 9 },
    { name: 'needs_info', label: 'Needs Info', color: '#eab308', category: 'waiting_for_input', position: 10 },
    { name: 'done', label: 'Done', color: '#22c55e', isFinal: true, category: 'terminal', position: 11 },
    { name: 'workflow_review', label: 'Workflow Review', color: '#d946ef', category: 'agent_running', position: 12 },
    { name: 'closed', label: 'Closed', color: '#6b7280', isFinal: true, category: 'terminal', position: 13 },
  ],
  transitions: [
    // ── Generated per-phase transitions ──────────────────────────────
    // For each phase: start from open, completion, needs_info,
    // info_provided resume, auto-retry on failure, cancel to open.
    ...perPhaseTransitions,

    // ── Backlog ──────────────────────────────────────────────────────
    { from: 'open', to: 'backlog', trigger: 'manual', label: 'Move to Backlog',
      guards: [{ name: 'no_running_agent' }] },
    { from: 'backlog', to: 'open', trigger: 'manual', label: 'Move to Open',
      guards: [{ name: 'no_running_agent' }] },

    // ── Review gate exits ───────────────────────────────────────────
    // At each review gate the human chooses the next phase.
    // This is where the flow becomes dynamic — simple tasks skip ahead,
    // complex tasks go through more phases.

    // Investigation review → implement (simple) / design (complex) / re-investigate
    { from: 'investigation_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'new')] },
    { from: 'investigation_review', to: 'designing', trigger: 'manual', label: 'Start Technical Design',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('designer', 'new')] },
    { from: 'investigation_review', to: 'investigating', trigger: 'manual', label: 'Request Investigation Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('investigator', 'new')] },

    // Design review → plan / implement / re-design
    { from: 'design_review', to: 'planning', trigger: 'manual', label: 'Approve & Plan',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('planner', 'new')] },
    { from: 'design_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'new')] },
    { from: 'design_review', to: 'designing', trigger: 'manual', label: 'Request Design Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('designer', 'revision', 'changes_requested')] },

    // Plan review → implement / re-plan
    { from: 'plan_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'new')] },
    { from: 'plan_review', to: 'planning', trigger: 'manual', label: 'Request Plan Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('planner', 'revision', 'changes_requested')] },

    // ── PR review (manual) ──────────────────────────────────────────
    { from: 'pr_review', to: 'implementing', trigger: 'manual', label: 'Request Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'revision', 'changes_requested')] },
    ...prApprove('manual'),
    { from: 'pr_review', to: 'pr_review', trigger: 'manual', label: 'Re-run PR Review',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('reviewer', 'new')] },

    // ── PR review (agent outcomes) ──────────────────────────────────
    ...prApprove('agent'),
    { from: 'pr_review', to: 'implementing', trigger: 'agent', agentOutcome: 'changes_requested',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'revision', 'changes_requested')] },
    { from: 'pr_review', to: 'pr_review', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [startAgent('reviewer', 'new')] },

    // ── Merge ───────────────────────────────────────────────────────
    { from: 'ready_to_merge', to: 'done', trigger: 'manual', label: 'Merge',
      hooks: [{ name: 'merge_pr', policy: 'required' }, { name: 'advance_phase', policy: 'best_effort' },
        notify('Merged', 'Merged: {taskTitle}')] },

    // ── Implementing special outcomes ───────────────────────────────
    { from: 'implementing', to: 'open', trigger: 'agent', agentOutcome: 'no_changes' },
    { from: 'implementing', to: 'ready_to_merge', trigger: 'agent', agentOutcome: 'already_on_main' },
    { from: 'implementing', to: 'implementing', trigger: 'agent', agentOutcome: 'conflicts_detected',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'revision', 'merge_failed')] },
    { from: 'implementing', to: 'implementing', trigger: 'agent', agentOutcome: 'uncommitted_changes',
      guards: [{ name: 'max_retries', params: { max: 1 } }, { name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'revision', 'uncommitted_changes')] },

    // ── PR push retry ───────────────────────────────────────────────
    { from: 'pr_review', to: 'pr_review', trigger: 'agent', agentOutcome: 'pr_ready',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [
        { name: 'push_and_create_pr', policy: 'required' },
        startAgent('reviewer', 'new'),
      ] },

    // ── Phase cycling ───────────────────────────────────────────────
    { from: 'done', to: 'implementing', trigger: 'system',
      guards: [{ name: 'has_pending_phases' }, { name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'new')] },
    { from: 'done', to: 'implementing', trigger: 'manual', label: 'Retry Next Phase',
      guards: [{ name: 'has_pending_phases' }, { name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'new')] },

    // ── Recovery: backtrack from implementing ───────────────────────
    { from: 'implementing', to: 'plan_review', trigger: 'manual', label: 'Back to Plan Review' },
    { from: 'implementing', to: 'design_review', trigger: 'manual', label: 'Back to Design Review' },
    { from: 'implementing', to: 'investigation_review', trigger: 'manual', label: 'Back to Investigation Review' },
    { from: 'design_review', to: 'open', trigger: 'manual', label: 'Cancel Design Review' },

    // ── Close / Reopen ──────────────────────────────────────────────
    { from: '*', to: 'closed', trigger: 'manual', label: 'Close Task',
      guards: [{ name: 'no_running_agent' }] },
    { from: 'closed', to: 'open', trigger: 'manual', label: 'Reopen' },

    // ── Workflow review ─────────────────────────────────────────────
    { from: 'done', to: 'workflow_review', trigger: 'manual', label: 'Review Workflow',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('task-workflow-reviewer', 'new')] },
    { from: 'workflow_review', to: 'done', trigger: 'agent', agentOutcome: 'review_complete' },
    { from: 'workflow_review', to: 'done', trigger: 'agent', agentOutcome: 'failed' },

    // ── Ready-to-merge recovery ─────────────────────────────────────
    { from: 'ready_to_merge', to: 'implementing', trigger: 'manual', label: 'Request Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'revision', 'changes_requested')] },
    { from: 'ready_to_merge', to: 'implementing', trigger: 'system', label: 'Merge Failed - Auto Retry',
      guards: [{ name: 'no_running_agent' }],
      hooks: [startAgent('implementor', 'revision', 'merge_failed')] },
    { from: 'done', to: 'ready_to_merge', trigger: 'manual', label: 'Merge Failed - Retry' },
  ],
};

export const SEEDED_PIPELINES = [AGENT_PIPELINE];
