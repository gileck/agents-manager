import type { PipelineStatus, Transition } from '../../shared/types';

export interface SeededPipeline {
  id: string;
  name: string;
  description: string;
  taskType: string;
  statuses: PipelineStatus[];
  transitions: Transition[];
}

export const AGENT_PIPELINE: SeededPipeline = {
  id: 'pipeline-agent',
  name: 'Agent-Driven',
  description: 'Agent-driven workflow with investigation, tech design, plan, implement, and review phases',
  taskType: 'agent',
  statuses: [
    { name: 'open', label: 'Open', category: 'ready', position: 0 },
    { name: 'investigating', label: 'Investigating', color: '#f59e0b', category: 'agent_running', position: 1 },
    { name: 'investigation_review', label: 'Investigation Review', color: '#8b5cf6', category: 'human_review', position: 2 },
    { name: 'designing', label: 'Designing', category: 'agent_running', position: 3 },
    { name: 'design_review', label: 'Design Review', category: 'human_review', position: 4 },
    { name: 'planning', label: 'Planning', category: 'agent_running', position: 5 },
    { name: 'plan_review', label: 'Plan Review', category: 'human_review', position: 6 },
    { name: 'implementing', label: 'Implementing', category: 'agent_running', position: 7 },
    { name: 'pr_review', label: 'PR Review', category: 'human_review', position: 8 },
    { name: 'ready_to_merge', label: 'Ready to Merge', category: 'human_review', position: 9 },
    { name: 'needs_info', label: 'Needs Info', category: 'waiting_for_input', position: 10 },
    { name: 'done', label: 'Done', isFinal: true, category: 'terminal', position: 11 },
    { name: 'workflow_review', label: 'Workflow Review', category: 'agent_running', position: 12 },
    { name: 'closed', label: 'Closed', isFinal: true, category: 'terminal', position: 13 },
  ],
  transitions: [
    // === Manual transitions from open ===
    { from: 'open', to: 'investigating', trigger: 'manual', label: 'Start Investigation',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'investigator' }, policy: 'fire_and_forget' }] },
    { from: 'open', to: 'designing', trigger: 'manual', label: 'Start Tech Design',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'designer' }, policy: 'fire_and_forget' }] },
    { from: 'open', to: 'planning', trigger: 'manual', label: 'Start Planning',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'planner' }, policy: 'fire_and_forget' }] },
    { from: 'open', to: 'implementing', trigger: 'manual', label: 'Start Implementing',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'implementor' }, policy: 'fire_and_forget' }] },

    // === Investigation review transitions ===
    { from: 'investigation_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'implementor' }, policy: 'fire_and_forget' }] },
    { from: 'investigation_review', to: 'designing', trigger: 'manual', label: 'Start Technical Design',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'designer' }, policy: 'fire_and_forget' }] },
    { from: 'investigation_review', to: 'investigating', trigger: 'manual', label: 'Request Investigation Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'investigator' }, policy: 'fire_and_forget' }] },

    // === Plan review transitions ===
    { from: 'plan_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'implementor' }, policy: 'fire_and_forget' }] },
    { from: 'plan_review', to: 'planning', trigger: 'manual', label: 'Request Plan Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'planner', revisionReason: 'changes_requested' }, policy: 'fire_and_forget' }] },

    // === Design review transitions ===
    { from: 'design_review', to: 'planning', trigger: 'manual', label: 'Approve & Plan',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'planner' }, policy: 'fire_and_forget' }] },
    { from: 'design_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'implementor' }, policy: 'fire_and_forget' }] },
    { from: 'design_review', to: 'designing', trigger: 'manual', label: 'Request Design Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'designer', revisionReason: 'changes_requested' }, policy: 'fire_and_forget' }] },

    // === PR review transitions ===
    { from: 'pr_review', to: 'implementing', trigger: 'manual', label: 'Request Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'implementor', revisionReason: 'changes_requested' }, policy: 'fire_and_forget' }] },
    // Multi-phase manual approve: auto-merge and cycle when phases remain
    { from: 'pr_review', to: 'done', trigger: 'manual', label: 'Approve',
      guards: [{ name: 'has_pending_phases' }],
      hooks: [
        { name: 'merge_pr', policy: 'required' },
        { name: 'advance_phase', policy: 'best_effort' },
      ] },
    // Single-phase or final phase: go to ready_to_merge for manual merge
    { from: 'pr_review', to: 'ready_to_merge', trigger: 'manual', label: 'Approve',
      hooks: [{ name: 'notify', params: { titleTemplate: 'PR approved', bodyTemplate: 'PR approved: {taskTitle}' }, policy: 'best_effort' }] },
    { from: 'pr_review', to: 'pr_review', trigger: 'manual', label: 'Re-run PR Review',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'reviewer' }, policy: 'fire_and_forget' }] },

    // === Merge ===
    { from: 'ready_to_merge', to: 'done', trigger: 'manual', label: 'Merge',
      guards: [{ name: 'is_admin' }],
      hooks: [{ name: 'merge_pr', policy: 'required' }, { name: 'advance_phase', policy: 'best_effort' }] },

    // === Agent outcome auto-transitions ===
    { from: 'investigating', to: 'investigation_review', trigger: 'agent', agentOutcome: 'investigation_complete',
      hooks: [{ name: 'notify', params: { titleTemplate: 'Investigation ready', bodyTemplate: 'Investigation ready: {taskTitle}\n\nSummary: {summary}' }, policy: 'best_effort' }] },
    { from: 'designing', to: 'design_review', trigger: 'agent', agentOutcome: 'design_ready',
      hooks: [{ name: 'notify', params: { titleTemplate: 'Design ready', bodyTemplate: 'Technical design ready: {taskTitle}\n\nSummary: {summary}' }, policy: 'best_effort' }] },
    { from: 'planning', to: 'plan_review', trigger: 'agent', agentOutcome: 'plan_complete',
      hooks: [{ name: 'notify', params: { titleTemplate: 'Plan ready', bodyTemplate: 'Plan ready: {taskTitle}\n\nSummary: {summary}' }, policy: 'best_effort' }] },
    { from: 'implementing', to: 'pr_review', trigger: 'agent', agentOutcome: 'pr_ready',
      hooks: [
        { name: 'push_and_create_pr', policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'PR ready', bodyTemplate: 'PR ready: {taskTitle}\n\nSummary: {summary}' }, policy: 'best_effort' },
        { name: 'start_agent', params: { mode: 'new', agentType: 'reviewer' }, policy: 'fire_and_forget' },
      ] },

    // === Needs info transitions (from any agent phase) ===
    { from: 'investigating', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' }, policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' }, policy: 'best_effort' },
      ] },
    { from: 'designing', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' }, policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' }, policy: 'best_effort' },
      ] },
    { from: 'planning', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' }, policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' }, policy: 'best_effort' },
      ] },
    { from: 'implementing', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' }, policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' }, policy: 'best_effort' },
      ] },

    // === Human-in-the-loop resume (auto-start agent after info provided) ===
    { from: 'needs_info', to: 'investigating', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'investigator', revisionReason: 'info_provided' }, policy: 'fire_and_forget' }] },
    { from: 'needs_info', to: 'designing', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'designer', revisionReason: 'info_provided' }, policy: 'fire_and_forget' }] },
    { from: 'needs_info', to: 'planning', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'planner', revisionReason: 'info_provided' }, policy: 'fire_and_forget' }] },
    { from: 'needs_info', to: 'implementing', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'implementor', revisionReason: 'info_provided' }, policy: 'fire_and_forget' }] },

    // === Auto-retry on agent failure ===
    { from: 'investigating', to: 'investigating', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'investigator' }, policy: 'fire_and_forget' }] },
    { from: 'designing', to: 'designing', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'designer' }, policy: 'fire_and_forget' }] },
    { from: 'planning', to: 'planning', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'planner' }, policy: 'fire_and_forget' }] },
    { from: 'implementing', to: 'implementing', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'implementor' }, policy: 'fire_and_forget' }] },

    // === PR review agent outcomes ===
    // Multi-phase auto-merge: when phases remain, merge immediately and cycle back
    { from: 'pr_review', to: 'done', trigger: 'agent', agentOutcome: 'approved',
      guards: [{ name: 'has_pending_phases' }],
      hooks: [
        { name: 'merge_pr', policy: 'required' },
        { name: 'advance_phase', policy: 'best_effort' },
      ] },
    // Single-phase or final phase: go to ready_to_merge for manual merge
    { from: 'pr_review', to: 'ready_to_merge', trigger: 'agent', agentOutcome: 'approved',
      hooks: [{ name: 'notify', params: { titleTemplate: 'PR approved', bodyTemplate: 'PR approved: {taskTitle}' }, policy: 'best_effort' }] },
    { from: 'pr_review', to: 'implementing', trigger: 'agent', agentOutcome: 'changes_requested',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'implementor', revisionReason: 'changes_requested' }, policy: 'fire_and_forget' }] },
    { from: 'pr_review', to: 'pr_review', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'reviewer' }, policy: 'fire_and_forget' }] },

    // === No changes detected on branch after implementation ===
    { from: 'implementing', to: 'open', trigger: 'agent', agentOutcome: 'no_changes' },

    // === Merge conflict detection — self-loop to resolve conflicts ===
    { from: 'implementing', to: 'implementing', trigger: 'agent', agentOutcome: 'conflicts_detected',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'implementor', revisionReason: 'conflicts_detected' }, policy: 'fire_and_forget' }] },

    // === PR push retry (handles conflicts arising after agent-service check or after request_changes) ===
    { from: 'pr_review', to: 'pr_review', trigger: 'agent', agentOutcome: 'pr_ready',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [
        { name: 'push_and_create_pr', policy: 'required' },
        { name: 'start_agent', params: { mode: 'new', agentType: 'reviewer' }, policy: 'fire_and_forget' },
      ] },

    // === Phase cycling: done → implementing when more phases remain ===
    { from: 'done', to: 'implementing', trigger: 'system',
      guards: [{ name: 'has_pending_phases' }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'implementor' }, policy: 'fire_and_forget' }] },
    { from: 'done', to: 'implementing', trigger: 'manual', label: 'Retry Next Phase',
      guards: [{ name: 'has_pending_phases' }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'implementor' }, policy: 'fire_and_forget' }] },

    // === Recovery: cancel agent phases back to open ===
    { from: 'investigating', to: 'open', trigger: 'manual', label: 'Cancel Investigation' },
    { from: 'planning', to: 'open', trigger: 'manual', label: 'Cancel Planning' },
    { from: 'designing', to: 'open', trigger: 'manual', label: 'Cancel Design' },
    { from: 'implementing', to: 'open', trigger: 'manual', label: 'Cancel Implementation' },
    { from: 'implementing', to: 'plan_review', trigger: 'manual', label: 'Back to Plan Review' },
    { from: 'implementing', to: 'design_review', trigger: 'manual', label: 'Back to Design Review' },
    { from: 'implementing', to: 'investigation_review', trigger: 'manual', label: 'Back to Investigation Review' },
    { from: 'design_review', to: 'open', trigger: 'manual', label: 'Cancel Design Review' },

    // === Close / Reopen ===
    { from: '*', to: 'closed', trigger: 'manual', label: 'Close Task',
      guards: [{ name: 'no_running_agent' }] },
    { from: 'closed', to: 'open', trigger: 'manual', label: 'Reopen' },

    // === Workflow review (manual trigger from done) ===
    { from: 'done', to: 'workflow_review', trigger: 'manual', label: 'Review Workflow',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'task-workflow-reviewer' }, policy: 'fire_and_forget' }] },
    { from: 'workflow_review', to: 'done', trigger: 'agent', agentOutcome: 'review_complete' },
    { from: 'workflow_review', to: 'done', trigger: 'agent', agentOutcome: 'failed' },

    // === Request changes from ready_to_merge ===
    { from: 'ready_to_merge', to: 'implementing', trigger: 'manual', label: 'Request Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'revision', agentType: 'implementor', revisionReason: 'changes_requested' }, policy: 'fire_and_forget' }] },

    // === Manual recovery if merge_pr safety net catches a conflict ===
    { from: 'done', to: 'ready_to_merge', trigger: 'manual', label: 'Merge Failed - Retry' },
  ],
};

export const SEEDED_PIPELINES = [AGENT_PIPELINE];
