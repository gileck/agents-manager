import type { PipelineStatus, Transition } from '../../shared/types';

export interface SeededPipeline {
  id: string;
  name: string;
  description: string;
  taskType: string;
  statuses: PipelineStatus[];
  transitions: Transition[];
}

export const SIMPLE_PIPELINE: SeededPipeline = {
  id: 'pipeline-simple',
  name: 'Simple',
  description: 'Basic open → in_progress → done workflow',
  taskType: 'simple',
  statuses: [
    { name: 'open', label: 'Open', color: '#6b7280', category: 'ready', position: 0 },
    { name: 'in_progress', label: 'In Progress', color: '#3b82f6', category: 'agent_running', position: 1 },
    { name: 'done', label: 'Done', color: '#22c55e', isFinal: true, category: 'terminal', position: 2 },
  ],
  transitions: [
    { from: 'open', to: 'in_progress', trigger: 'manual', label: 'Start' },
    { from: 'in_progress', to: 'done', trigger: 'manual', label: 'Complete' },
    { from: 'in_progress', to: 'open', trigger: 'manual', label: 'Reopen' },
  ],
};

export const FEATURE_PIPELINE: SeededPipeline = {
  id: 'pipeline-feature',
  name: 'Feature',
  description: 'Feature development workflow with PR review',
  taskType: 'feature',
  statuses: [
    { name: 'backlog', label: 'Backlog', color: '#6b7280', category: 'ready', position: 0 },
    { name: 'in_progress', label: 'In Progress', color: '#3b82f6', category: 'agent_running', position: 1 },
    { name: 'in_review', label: 'In Review', color: '#f59e0b', category: 'human_review', position: 2 },
    { name: 'done', label: 'Done', color: '#22c55e', isFinal: true, category: 'terminal', position: 3 },
  ],
  transitions: [
    { from: 'backlog', to: 'in_progress', trigger: 'manual', label: 'Start' },
    {
      from: 'in_progress',
      to: 'in_review',
      trigger: 'manual',
      label: 'Submit for Review',
      guards: [{ name: 'has_pr' }],
    },
    { from: 'in_review', to: 'done', trigger: 'manual', label: 'Approve & Merge' },
    { from: 'in_review', to: 'in_progress', trigger: 'manual', label: 'Request Changes' },
    { from: 'in_progress', to: 'backlog', trigger: 'manual', label: 'Move to Backlog' },
  ],
};

export const BUG_PIPELINE: SeededPipeline = {
  id: 'pipeline-bug',
  name: 'Bug',
  description: 'Bug fix workflow with verification',
  taskType: 'bug',
  statuses: [
    { name: 'reported', label: 'Reported', color: '#ef4444', category: 'ready', position: 0 },
    { name: 'investigating', label: 'Investigating', color: '#f59e0b', category: 'agent_running', position: 1 },
    { name: 'fixing', label: 'Fixing', color: '#3b82f6', category: 'agent_running', position: 2 },
    { name: 'resolved', label: 'Resolved', color: '#22c55e', isFinal: true, category: 'terminal', position: 3 },
  ],
  transitions: [
    { from: 'reported', to: 'investigating', trigger: 'manual', label: 'Investigate' },
    { from: 'investigating', to: 'fixing', trigger: 'manual', label: 'Start Fix' },
    { from: 'fixing', to: 'resolved', trigger: 'manual', label: 'Resolve' },
    { from: 'fixing', to: 'investigating', trigger: 'manual', label: 'Reopen Investigation' },
    { from: 'investigating', to: 'reported', trigger: 'manual', label: 'Cannot Reproduce' },
  ],
};

export const AGENT_PIPELINE: SeededPipeline = {
  id: 'pipeline-agent',
  name: 'Agent-Driven',
  description: 'Agent-driven workflow with tech design, plan, implement, and review phases',
  taskType: 'agent',
  statuses: [
    { name: 'open', label: 'Open', category: 'ready', position: 0 },
    { name: 'designing', label: 'Designing', category: 'agent_running', position: 1 },
    { name: 'design_review', label: 'Design Review', category: 'human_review', position: 2 },
    { name: 'planning', label: 'Planning', category: 'agent_running', position: 3 },
    { name: 'plan_review', label: 'Plan Review', category: 'human_review', position: 4 },
    { name: 'implementing', label: 'Implementing', category: 'agent_running', position: 5 },
    { name: 'pr_review', label: 'PR Review', category: 'human_review', position: 6 },
    { name: 'needs_info', label: 'Needs Info', category: 'waiting_for_input', position: 7 },
    { name: 'done', label: 'Done', isFinal: true, category: 'terminal', position: 8 },
  ],
  transitions: [
    // From open: 3 options — tech design (skippable), plan (skippable), implement (required)
    { from: 'open', to: 'designing', trigger: 'manual', label: 'Start Tech Design',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'technical_design', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'open', to: 'planning', trigger: 'manual', label: 'Start Planning',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'plan', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'open', to: 'implementing', trigger: 'manual', label: 'Start Implementing',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'plan_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'plan_review', to: 'planning', trigger: 'manual', label: 'Request Plan Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'plan_revision', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'pr_review', to: 'implementing', trigger: 'manual', label: 'Request Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'request_changes', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'pr_review', to: 'done', trigger: 'manual', label: 'Approve & Merge',
      hooks: [{ name: 'merge_pr', policy: 'required' }] },
    // Design review transitions — approve to plan, skip to implement, or request changes
    { from: 'design_review', to: 'planning', trigger: 'manual', label: 'Approve & Plan',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'plan', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'design_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'design_review', to: 'designing', trigger: 'manual', label: 'Request Design Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'technical_design_revision', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    // Agent outcome auto-transitions
    { from: 'planning', to: 'plan_review', trigger: 'agent', agentOutcome: 'plan_complete',
      hooks: [{ name: 'notify', params: { titleTemplate: 'Plan ready', bodyTemplate: 'Plan ready: {taskTitle}' }, policy: 'best_effort' }] },
    { from: 'designing', to: 'design_review', trigger: 'agent', agentOutcome: 'design_ready',
      hooks: [{ name: 'notify', params: { titleTemplate: 'Design ready', bodyTemplate: 'Technical design ready: {taskTitle}' }, policy: 'best_effort' }] },
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
    { from: 'implementing', to: 'pr_review', trigger: 'agent', agentOutcome: 'pr_ready',
      hooks: [
        { name: 'push_and_create_pr', policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'PR ready', bodyTemplate: 'PR ready: {taskTitle}' }, policy: 'best_effort' },
        { name: 'start_agent', params: { mode: 'review', agentType: 'pr-reviewer' }, policy: 'fire_and_forget' },
      ] },
    { from: 'implementing', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' }, policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' }, policy: 'best_effort' },
      ] },
    // Human-in-the-loop resume (auto-start agent after info provided)
    { from: 'needs_info', to: 'planning', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'plan_resume', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'needs_info', to: 'implementing', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'implement_resume', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    // Human-in-the-loop resume for designing
    { from: 'needs_info', to: 'designing', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'technical_design_resume', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    // Auto-retry on agent failure (self-transitions gated by max_retries)
    { from: 'planning', to: 'planning', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'plan', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'designing', to: 'designing', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'technical_design', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'implementing', to: 'implementing', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    // PR review agent outcomes
    { from: 'pr_review', to: 'done', trigger: 'agent', agentOutcome: 'approved',
      hooks: [{ name: 'merge_pr', policy: 'required' }] },
    { from: 'pr_review', to: 'implementing', trigger: 'agent', agentOutcome: 'changes_requested',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'request_changes', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'pr_review', to: 'pr_review', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'review', agentType: 'pr-reviewer' }, policy: 'fire_and_forget' }] },
    // No changes detected on branch after implementation
    { from: 'implementing', to: 'open', trigger: 'agent', agentOutcome: 'no_changes' },
    // Merge conflict detection — self-loop to resolve conflicts
    { from: 'implementing', to: 'implementing', trigger: 'agent', agentOutcome: 'conflicts_detected',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'resolve_conflicts', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    // PR push retry (handles conflicts arising after agent-service check or after request_changes)
    { from: 'pr_review', to: 'pr_review', trigger: 'agent', agentOutcome: 'pr_ready',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [
        { name: 'push_and_create_pr', policy: 'required' },
        { name: 'start_agent', params: { mode: 'review', agentType: 'pr-reviewer' }, policy: 'fire_and_forget' },
      ] },
    // Recovery: cancel agent phases back to open
    { from: 'planning', to: 'open', trigger: 'manual', label: 'Cancel Planning' },
    { from: 'designing', to: 'open', trigger: 'manual', label: 'Cancel Design' },
    { from: 'implementing', to: 'open', trigger: 'manual', label: 'Cancel Implementation' },
    { from: 'implementing', to: 'plan_review', trigger: 'manual', label: 'Back to Plan Review' },
    { from: 'implementing', to: 'design_review', trigger: 'manual', label: 'Back to Design Review' },
    { from: 'design_review', to: 'open', trigger: 'manual', label: 'Cancel Design Review' },
    // Manual recovery if merge_pr safety net catches a conflict
    { from: 'done', to: 'pr_review', trigger: 'manual', label: 'Merge Failed - Retry' },
  ],
};

export const BUG_AGENT_PIPELINE: SeededPipeline = {
  id: 'pipeline-bug-agent',
  name: 'Bug (Agent-Driven)',
  description: 'Agent-driven bug investigation and fix workflow',
  taskType: 'bug-agent',
  statuses: [
    { name: 'reported', label: 'Reported', color: '#ef4444', category: 'ready', position: 0 },
    { name: 'investigating', label: 'Investigating', color: '#f59e0b', category: 'agent_running', position: 1 },
    { name: 'investigation_review', label: 'Investigation Review', color: '#8b5cf6', category: 'human_review', position: 2 },
    { name: 'designing', label: 'Designing', category: 'agent_running', position: 3 },
    { name: 'design_review', label: 'Design Review', category: 'human_review', position: 4 },
    { name: 'implementing', label: 'Implementing', color: '#3b82f6', category: 'agent_running', position: 5 },
    { name: 'pr_review', label: 'PR Review', color: '#06b6d4', category: 'human_review', position: 6 },
    { name: 'needs_info', label: 'Needs Info', color: '#6b7280', category: 'waiting_for_input', position: 7 },
    { name: 'done', label: 'Done', color: '#22c55e', isFinal: true, category: 'terminal', position: 8 },
  ],
  transitions: [
    // Manual transitions
    { from: 'reported', to: 'investigating', trigger: 'manual', label: 'Start Investigation',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'investigate', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'reported', to: 'implementing', trigger: 'manual', label: 'Start Implementing',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'investigation_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'investigation_review', to: 'designing', trigger: 'manual', label: 'Start Technical Design',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'technical_design', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'investigation_review', to: 'investigating', trigger: 'manual', label: 'Request Investigation Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'investigate', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    // Design review transitions
    { from: 'design_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'design_review', to: 'designing', trigger: 'manual', label: 'Request Design Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'technical_design_revision', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'pr_review', to: 'implementing', trigger: 'manual', label: 'Request Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'request_changes', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'pr_review', to: 'done', trigger: 'manual', label: 'Approve & Merge',
      hooks: [{ name: 'merge_pr', policy: 'required' }] },
    // Agent outcome auto-transitions
    { from: 'investigating', to: 'investigation_review', trigger: 'agent', agentOutcome: 'investigation_complete',
      hooks: [{ name: 'notify', params: { titleTemplate: 'Investigation ready', bodyTemplate: 'Investigation ready: {taskTitle}' }, policy: 'best_effort' }] },
    { from: 'designing', to: 'design_review', trigger: 'agent', agentOutcome: 'design_ready',
      hooks: [{ name: 'notify', params: { titleTemplate: 'Design ready', bodyTemplate: 'Technical design ready: {taskTitle}' }, policy: 'best_effort' }] },
    { from: 'designing', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' }, policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' }, policy: 'best_effort' },
      ] },
    { from: 'investigating', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' }, policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' }, policy: 'best_effort' },
      ] },
    { from: 'implementing', to: 'pr_review', trigger: 'agent', agentOutcome: 'pr_ready',
      hooks: [
        { name: 'push_and_create_pr', policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'PR ready', bodyTemplate: 'PR ready: {taskTitle}' }, policy: 'best_effort' },
        { name: 'start_agent', params: { mode: 'review', agentType: 'pr-reviewer' }, policy: 'fire_and_forget' },
      ] },
    { from: 'implementing', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' }, policy: 'required' },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' }, policy: 'best_effort' },
      ] },
    // Human-in-the-loop resume
    { from: 'needs_info', to: 'investigating', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'investigate_resume', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'needs_info', to: 'designing', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'technical_design_resume', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'needs_info', to: 'implementing', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'implement_resume', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    // Auto-retry on failure
    { from: 'investigating', to: 'investigating', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'investigate', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'designing', to: 'designing', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'technical_design', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'implementing', to: 'implementing', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    // PR review agent outcomes
    { from: 'pr_review', to: 'done', trigger: 'agent', agentOutcome: 'approved',
      hooks: [{ name: 'merge_pr', policy: 'required' }] },
    { from: 'pr_review', to: 'implementing', trigger: 'agent', agentOutcome: 'changes_requested',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'request_changes', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    { from: 'pr_review', to: 'pr_review', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'review', agentType: 'pr-reviewer' }, policy: 'fire_and_forget' }] },
    // No changes detected on branch after implementation
    { from: 'implementing', to: 'reported', trigger: 'agent', agentOutcome: 'no_changes' },
    // Merge conflict detection — self-loop to resolve conflicts
    { from: 'implementing', to: 'implementing', trigger: 'agent', agentOutcome: 'conflicts_detected',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'resolve_conflicts', agentType: 'claude-code' }, policy: 'fire_and_forget' }] },
    // PR push retry (handles conflicts arising after agent-service check or after request_changes)
    { from: 'pr_review', to: 'pr_review', trigger: 'agent', agentOutcome: 'pr_ready',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [
        { name: 'push_and_create_pr', policy: 'required' },
        { name: 'start_agent', params: { mode: 'review', agentType: 'pr-reviewer' }, policy: 'fire_and_forget' },
      ] },
    // Recovery
    { from: 'investigating', to: 'reported', trigger: 'manual', label: 'Cancel Investigation' },
    { from: 'designing', to: 'reported', trigger: 'manual', label: 'Cancel Design' },
    { from: 'implementing', to: 'reported', trigger: 'manual', label: 'Cancel Implementation' },
    { from: 'implementing', to: 'investigation_review', trigger: 'manual', label: 'Back to Investigation Review' },
    { from: 'implementing', to: 'design_review', trigger: 'manual', label: 'Back to Design Review' },
    { from: 'design_review', to: 'reported', trigger: 'manual', label: 'Cancel Design Review' },
    // Manual recovery if merge_pr safety net catches a conflict
    { from: 'done', to: 'pr_review', trigger: 'manual', label: 'Merge Failed - Retry' },
  ],
};

export const SEEDED_PIPELINES = [SIMPLE_PIPELINE, FEATURE_PIPELINE, BUG_PIPELINE, AGENT_PIPELINE, BUG_AGENT_PIPELINE];
