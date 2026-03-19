/**
 * Tests for pipeline notification context — "actions taken" and "next steps"
 * appended to system notifications sent to the orchestrator agent.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPipelineNotificationContext,
  formatSystemNotification,
} from '../../src/core/services/pipeline-notification-context';

// ---------------------------------------------------------------------------
// buildPipelineNotificationContext
// ---------------------------------------------------------------------------

describe('buildPipelineNotificationContext', () => {
  it('planning → plan_review (plan_complete)', () => {
    const ctx = buildPipelineNotificationContext('plan_complete', 'planner', 'planning', 'plan_review');
    expect(ctx.actionsTaken).toContain('Plan written to task.');
    expect(ctx.actionsTaken).toContain('Task transitioned to `plan_review`.');
    expect(ctx.next).toContain('Present the plan to the user');
    expect(ctx.next).toContain('Do NOT transition without user approval');
  });

  it('designing → design_review (design_ready)', () => {
    const ctx = buildPipelineNotificationContext('design_ready', 'designer', 'designing', 'design_review');
    expect(ctx.actionsTaken).toContain('Technical design written to task.');
    expect(ctx.actionsTaken).toContain('Task transitioned to `design_review`.');
    expect(ctx.next).toContain('Present the technical design');
    expect(ctx.next).toContain('Do NOT transition without user approval');
  });

  it('investigating → investigation_review (investigation_complete)', () => {
    const ctx = buildPipelineNotificationContext('investigation_complete', 'investigator', 'investigating', 'investigation_review');
    expect(ctx.actionsTaken).toContain('Investigation results written to task.');
    expect(ctx.actionsTaken).toContain('Task transitioned to `investigation_review`.');
    expect(ctx.next).toContain('Present the investigation findings');
  });

  it('implementing → pr_review (pr_ready) with PR link', () => {
    const ctx = buildPipelineNotificationContext('pr_ready', 'implementor', 'implementing', 'pr_review', {
      prLink: 'https://github.com/org/repo/pull/42',
    });
    expect(ctx.actionsTaken.some(a => a.includes('PR created at https://github.com/org/repo/pull/42'))).toBe(true);
    expect(ctx.actionsTaken).toContain('Code implemented and committed.');
    expect(ctx.next).toContain('reviewer agent will start automatically');
    expect(ctx.next).toContain('Do NOT start a reviewer manually');
  });

  it('implementing → pr_review (pr_ready) without PR link', () => {
    const ctx = buildPipelineNotificationContext('pr_ready', 'implementor', 'implementing', 'pr_review');
    expect(ctx.actionsTaken.some(a => a.includes('PR created.'))).toBe(true);
  });

  it('pr_review → ready_to_merge (approved)', () => {
    const ctx = buildPipelineNotificationContext('approved', 'reviewer', 'pr_review', 'ready_to_merge');
    expect(ctx.actionsTaken).toContain('PR approved by reviewer.');
    expect(ctx.next).toContain('ready to merge');
  });

  it('pr_review → done (approved, multi-phase intermediate)', () => {
    const ctx = buildPipelineNotificationContext('approved', 'reviewer', 'pr_review', 'done');
    expect(ctx.actionsTaken).toContain('Phase PR approved and merged.');
    expect(ctx.next).toContain('next phase automatically');
  });

  it('pr_review → implementing (changes_requested)', () => {
    const ctx = buildPipelineNotificationContext('changes_requested', 'reviewer', 'pr_review', 'implementing');
    expect(ctx.actionsTaken).toContain('Feedback submitted via `request_changes` with specific issues.');
    expect(ctx.actionsTaken).toContain('Task transitioned back to `implementing`.');
    expect(ctx.next).toContain('implementor will pick up the feedback');
    expect(ctx.next).toContain('Do NOT call `request_changes` again');
  });

  it('plan_review → planning (manual request changes)', () => {
    const ctx = buildPipelineNotificationContext('unknown', 'planner', 'plan_review', 'planning');
    expect(ctx.actionsTaken).toContain('Feedback submitted via `request_changes`.');
    expect(ctx.actionsTaken).toContain('Task transitioned back to `planning`.');
    expect(ctx.next).toContain('planner agent will revise the plan automatically');
  });

  it('design_review → designing (manual request changes)', () => {
    const ctx = buildPipelineNotificationContext('unknown', 'designer', 'design_review', 'designing');
    expect(ctx.actionsTaken).toContain('Feedback submitted via `request_changes`.');
    expect(ctx.actionsTaken).toContain('Task transitioned back to `designing`.');
    expect(ctx.next).toContain('designer agent will revise the design automatically');
  });

  it('investigation_review → investigating (manual request changes)', () => {
    const ctx = buildPipelineNotificationContext('unknown', 'investigator', 'investigation_review', 'investigating');
    expect(ctx.actionsTaken).toContain('Feedback submitted.');
    expect(ctx.next).toContain('investigator agent will revise automatically');
  });

  it('any → needs_info', () => {
    const ctx = buildPipelineNotificationContext('needs_info', 'planner', 'planning', 'needs_info');
    expect(ctx.actionsTaken.some(a => a.includes('planner agent needs additional information'))).toBe(true);
    expect(ctx.actionsTaken).toContain('A prompt has been created for human input.');
    expect(ctx.next).toContain('planner agent will resume automatically');
  });

  it('failed self-loop (auto-retry)', () => {
    const ctx = buildPipelineNotificationContext('failed', 'implementor', 'implementing', 'implementing');
    expect(ctx.actionsTaken.some(a => a.includes('implementor agent failed'))).toBe(true);
    expect(ctx.next).toContain('new implementor agent run will start automatically');
  });

  it('implementing → open (no_changes)', () => {
    const ctx = buildPipelineNotificationContext('no_changes', 'implementor', 'implementing', 'open');
    expect(ctx.actionsTaken.some(a => a.includes('no changes'))).toBe(true);
    expect(ctx.next).toContain('Review the task description');
  });

  it('ready_to_merge → done (merged)', () => {
    const ctx = buildPipelineNotificationContext('unknown', 'reviewer', 'ready_to_merge', 'done');
    expect(ctx.actionsTaken).toContain('PR merged successfully.');
    expect(ctx.next).toContain('Task is complete');
  });

  it('fallback for unmatched transition', () => {
    const ctx = buildPipelineNotificationContext('some_unknown', 'agent', 'status_a', 'status_b');
    expect(ctx.actionsTaken[0]).toContain('status_a');
    expect(ctx.actionsTaken[0]).toContain('status_b');
    expect(ctx.next).toContain('No specific follow-up');
  });
});

// ---------------------------------------------------------------------------
// formatSystemNotification
// ---------------------------------------------------------------------------

describe('formatSystemNotification', () => {
  it('includes all three sections: what happened, actions taken, and next', () => {
    const msg = formatSystemNotification({
      agentType: 'planner',
      taskTitle: 'Add login feature',
      outcome: 'plan_complete',
      fromStatus: 'planning',
      toStatus: 'plan_review',
      summary: 'Plan with 3 phases drafted',
    });

    // Section 1: What happened
    expect(msg).toContain('[System Notification]');
    expect(msg).toContain('planner agent for task "Add login feature"');
    expect(msg).toContain('outcome "plan_complete"');
    expect(msg).toContain('Status: planning → plan_review');
    expect(msg).toContain('Summary: Plan with 3 phases drafted');

    // Section 2: Actions taken
    expect(msg).toContain('**Actions taken:**');
    expect(msg).toContain('- Plan written to task.');

    // Section 3: Next
    expect(msg).toContain('**Next:**');
    expect(msg).toContain('Present the plan to the user for review');
  });

  it('omits summary when not provided', () => {
    const msg = formatSystemNotification({
      agentType: 'reviewer',
      taskTitle: 'Fix bug',
      outcome: 'approved',
      fromStatus: 'pr_review',
      toStatus: 'ready_to_merge',
    });

    expect(msg).not.toContain('Summary:');
    expect(msg).toContain('**Actions taken:**');
    expect(msg).toContain('**Next:**');
  });

  it('includes PR link for pr_ready outcome', () => {
    const msg = formatSystemNotification({
      agentType: 'implementor',
      taskTitle: 'Add caching',
      outcome: 'pr_ready',
      fromStatus: 'implementing',
      toStatus: 'pr_review',
      prLink: 'https://github.com/org/repo/pull/99',
    });

    expect(msg).toContain('https://github.com/org/repo/pull/99');
  });

  it('formats changes_requested with do-not-duplicate warning', () => {
    const msg = formatSystemNotification({
      agentType: 'reviewer',
      taskTitle: 'Auth refactor',
      outcome: 'changes_requested',
      fromStatus: 'pr_review',
      toStatus: 'implementing',
      summary: 'Two issues found in error handling',
    });

    expect(msg).toContain('Do NOT call `request_changes` again');
    expect(msg).toContain('implementor will pick up the feedback');
    expect(msg).toContain('Feedback submitted via `request_changes`');
  });
});
