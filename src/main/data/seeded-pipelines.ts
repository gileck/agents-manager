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
    { name: 'open', label: 'Open', color: '#6b7280' },
    { name: 'in_progress', label: 'In Progress', color: '#3b82f6' },
    { name: 'done', label: 'Done', color: '#22c55e', isFinal: true },
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
    { name: 'backlog', label: 'Backlog', color: '#6b7280' },
    { name: 'in_progress', label: 'In Progress', color: '#3b82f6' },
    { name: 'in_review', label: 'In Review', color: '#f59e0b' },
    { name: 'done', label: 'Done', color: '#22c55e', isFinal: true },
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
    { name: 'reported', label: 'Reported', color: '#ef4444' },
    { name: 'investigating', label: 'Investigating', color: '#f59e0b' },
    { name: 'fixing', label: 'Fixing', color: '#3b82f6' },
    { name: 'resolved', label: 'Resolved', color: '#22c55e', isFinal: true },
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
  description: 'Agent-driven workflow with plan, implement, and review phases',
  taskType: 'agent',
  statuses: [
    { name: 'open', label: 'Open' },
    { name: 'planning', label: 'Planning' },
    { name: 'plan_review', label: 'Plan Review' },
    { name: 'implementing', label: 'Implementing' },
    { name: 'pr_review', label: 'PR Review' },
    { name: 'needs_info', label: 'Needs Info' },
    { name: 'done', label: 'Done', isFinal: true },
  ],
  transitions: [
    // Manual transitions that auto-start agents via hooks
    { from: 'open', to: 'planning', trigger: 'manual', label: 'Start Planning',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'plan', agentType: 'claude-code' } }] },
    { from: 'open', to: 'implementing', trigger: 'manual', label: 'Start Implementing',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' } }] },
    { from: 'plan_review', to: 'implementing', trigger: 'manual', label: 'Approve & Implement',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' } }] },
    { from: 'pr_review', to: 'implementing', trigger: 'manual', label: 'Request Changes',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' } }] },
    { from: 'pr_review', to: 'done', trigger: 'manual', label: 'Approve & Merge',
      hooks: [{ name: 'merge_pr' }] },
    // Agent outcome auto-transitions
    { from: 'planning', to: 'plan_review', trigger: 'agent', agentOutcome: 'plan_complete',
      hooks: [{ name: 'notify', params: { titleTemplate: 'Plan ready', bodyTemplate: 'Plan ready: {taskTitle}' } }] },
    { from: 'planning', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' } },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' } },
      ] },
    { from: 'implementing', to: 'pr_review', trigger: 'agent', agentOutcome: 'pr_ready',
      hooks: [
        { name: 'push_and_create_pr' },
        { name: 'notify', params: { titleTemplate: 'PR ready', bodyTemplate: 'PR ready: {taskTitle}' } },
        { name: 'start_agent', params: { mode: 'review', agentType: 'pr-reviewer' } },
      ] },
    { from: 'implementing', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info',
      hooks: [
        { name: 'create_prompt', params: { resumeOutcome: 'info_provided' } },
        { name: 'notify', params: { titleTemplate: 'Info needed', bodyTemplate: 'Info needed: {taskTitle}' } },
      ] },
    // Human-in-the-loop resume (auto-start agent after info provided)
    { from: 'needs_info', to: 'planning', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'plan', agentType: 'claude-code' } }] },
    { from: 'needs_info', to: 'implementing', trigger: 'agent', agentOutcome: 'info_provided',
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' } }] },
    // Auto-retry on agent failure (self-transitions gated by max_retries)
    { from: 'planning', to: 'planning', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'plan', agentType: 'claude-code' } }] },
    { from: 'implementing', to: 'implementing', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'implement', agentType: 'claude-code' } }] },
    // PR review agent outcomes
    { from: 'pr_review', to: 'done', trigger: 'agent', agentOutcome: 'approved',
      hooks: [{ name: 'merge_pr' }] },
    { from: 'pr_review', to: 'implementing', trigger: 'agent', agentOutcome: 'changes_requested',
      guards: [{ name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'request_changes', agentType: 'claude-code' } }] },
    { from: 'pr_review', to: 'pr_review', trigger: 'agent', agentOutcome: 'failed',
      guards: [{ name: 'max_retries', params: { max: 3 } }, { name: 'no_running_agent' }],
      hooks: [{ name: 'start_agent', params: { mode: 'review', agentType: 'pr-reviewer' } }] },
    // Recovery: cancel agent phases back to open
    { from: 'planning', to: 'open', trigger: 'manual', label: 'Cancel Planning' },
    { from: 'implementing', to: 'open', trigger: 'manual', label: 'Cancel Implementation' },
    { from: 'implementing', to: 'plan_review', trigger: 'manual', label: 'Back to Plan Review' },
  ],
};

export const SEEDED_PIPELINES = [SIMPLE_PIPELINE, FEATURE_PIPELINE, BUG_PIPELINE, AGENT_PIPELINE];
