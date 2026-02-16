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
    // Agent starts work
    { from: 'open', to: 'planning', trigger: 'agent' },
    { from: 'open', to: 'implementing', trigger: 'agent' },
    // Agent outcomes
    { from: 'planning', to: 'plan_review', trigger: 'agent', agentOutcome: 'plan_complete' },
    { from: 'planning', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info' },
    { from: 'implementing', to: 'pr_review', trigger: 'agent', agentOutcome: 'pr_ready' },
    { from: 'implementing', to: 'needs_info', trigger: 'agent', agentOutcome: 'needs_info' },
    // Human-in-the-loop resume
    { from: 'needs_info', to: 'planning', trigger: 'agent', agentOutcome: 'info_provided' },
    { from: 'needs_info', to: 'implementing', trigger: 'agent', agentOutcome: 'info_provided' },
    // Manual transitions
    { from: 'plan_review', to: 'implementing', trigger: 'manual' },
    { from: 'pr_review', to: 'done', trigger: 'manual' },
    { from: 'pr_review', to: 'implementing', trigger: 'manual' },
    // Manual fallbacks
    { from: 'open', to: 'planning', trigger: 'manual' },
    { from: 'open', to: 'implementing', trigger: 'manual' },
  ],
};

export const SEEDED_PIPELINES = [SIMPLE_PIPELINE, FEATURE_PIPELINE, BUG_PIPELINE, AGENT_PIPELINE];
