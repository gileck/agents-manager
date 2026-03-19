/**
 * Generates contextual "actions taken" and "next steps" text for pipeline system notifications.
 *
 * This prevents the orchestrator from duplicating work that pipeline agents/hooks already did
 * (e.g., re-calling `request_changes` after the reviewer already submitted feedback).
 */

export interface PipelineNotificationContext {
  actionsTaken: string[];
  next: string;
}

/**
 * Build the post-event context for a pipeline system notification.
 *
 * @param outcome  - The agent outcome that triggered the transition (e.g. 'plan_complete', 'changes_requested')
 * @param agentType - The type of agent that just completed (e.g. 'planner', 'reviewer')
 * @param fromStatus - The task status before the transition
 * @param toStatus  - The task status after the transition
 * @param extra     - Optional extra data (e.g. prLink)
 */
export function buildPipelineNotificationContext(
  outcome: string,
  agentType: string,
  fromStatus: string,
  toStatus: string,
  extra?: { prLink?: string },
): PipelineNotificationContext {
  // --- Planning complete: planning → plan_review ---
  if (outcome === 'plan_complete' && fromStatus === 'planning' && toStatus === 'plan_review') {
    return {
      actionsTaken: [
        'Plan written to task.',
        'Task transitioned to `plan_review`.',
      ],
      next: 'Present the plan to the user for review. Use `get_task` to read the plan. Do NOT transition without user approval.',
    };
  }

  // --- Design complete: designing → design_review ---
  if (outcome === 'design_ready' && fromStatus === 'designing' && toStatus === 'design_review') {
    return {
      actionsTaken: [
        'Technical design written to task.',
        'Task transitioned to `design_review`.',
      ],
      next: 'Present the technical design to the user for review. Use `get_task` to read the design. Do NOT transition without user approval.',
    };
  }

  // --- Investigation complete: investigating → investigation_review ---
  if (outcome === 'investigation_complete' && fromStatus === 'investigating' && toStatus === 'investigation_review') {
    return {
      actionsTaken: [
        'Investigation results written to task.',
        'Task transitioned to `investigation_review`.',
      ],
      next: 'Present the investigation findings to the user for review. Use `get_task` to read the results. Do NOT transition without user approval.',
    };
  }

  // --- Implementation complete: implementing → pr_review ---
  if (outcome === 'pr_ready' && fromStatus === 'implementing' && toStatus === 'pr_review') {
    const actions = [
      'Code implemented and committed.',
      'PR created' + (extra?.prLink ? ` at ${extra.prLink}` : '') + '.',
      'Task transitioned to `pr_review`.',
    ];
    return {
      actionsTaken: actions,
      next: 'The reviewer agent will start automatically. Wait for the review outcome. Do NOT start a reviewer manually.',
    };
  }

  // --- PR review approved: pr_review → ready_to_merge (single-phase or final) ---
  if (outcome === 'approved' && fromStatus === 'pr_review' && toStatus === 'ready_to_merge') {
    return {
      actionsTaken: [
        'PR approved by reviewer.',
        'Task transitioned to `ready_to_merge`.',
      ],
      next: 'The PR is ready to merge. Inform the user and await their merge decision.',
    };
  }

  // --- PR review approved: pr_review → done (intermediate multi-phase) ---
  if (outcome === 'approved' && fromStatus === 'pr_review' && toStatus === 'done') {
    return {
      actionsTaken: [
        'Phase PR approved and merged.',
        'Task transitioned to `done`.',
      ],
      next: 'If more phases remain, the implementor will start the next phase automatically. No action needed.',
    };
  }

  // --- PR review changes requested: pr_review → implementing ---
  if (outcome === 'changes_requested' && fromStatus === 'pr_review' && toStatus === 'implementing') {
    return {
      actionsTaken: [
        'Feedback submitted via `request_changes` with specific issues.',
        'Task transitioned back to `implementing`.',
      ],
      next: 'The implementor will pick up the feedback and fix the issues automatically. Do NOT call `request_changes` again — it was already done by the reviewer.',
    };
  }

  // --- Plan review changes requested (manual): plan_review → planning ---
  if (fromStatus === 'plan_review' && toStatus === 'planning') {
    return {
      actionsTaken: [
        'Feedback submitted via `request_changes`.',
        'Task transitioned back to `planning`.',
      ],
      next: 'The planner agent will revise the plan automatically. Wait for it to complete.',
    };
  }

  // --- Design review changes requested (manual): design_review → designing ---
  if (fromStatus === 'design_review' && toStatus === 'designing') {
    return {
      actionsTaken: [
        'Feedback submitted via `request_changes`.',
        'Task transitioned back to `designing`.',
      ],
      next: 'The designer agent will revise the design automatically. Wait for it to complete.',
    };
  }

  // --- Investigation review changes requested (manual): investigation_review → investigating ---
  if (fromStatus === 'investigation_review' && toStatus === 'investigating') {
    return {
      actionsTaken: [
        'Feedback submitted.',
        'Task transitioned back to `investigating`.',
      ],
      next: 'The investigator agent will revise automatically. Wait for it to complete.',
    };
  }

  // --- Needs info: any → needs_info ---
  if (outcome === 'needs_info' && toStatus === 'needs_info') {
    return {
      actionsTaken: [
        `The ${agentType} agent needs additional information to proceed.`,
        'A prompt has been created for human input.',
        'Task transitioned to `needs_info`.',
      ],
      next: `Answer the pending question. The ${agentType} agent will resume automatically after the answer is provided.`,
    };
  }

  // --- Failed with auto-retry: self-loop (same status) ---
  if (outcome === 'failed' && fromStatus === toStatus) {
    return {
      actionsTaken: [
        `The ${agentType} agent failed.`,
        'Auto-retry initiated (if retries remain).',
      ],
      next: `A new ${agentType} agent run will start automatically. No action needed unless retries are exhausted.`,
    };
  }

  // --- No changes: implementing → open ---
  if (outcome === 'no_changes' && fromStatus === 'implementing' && toStatus === 'open') {
    return {
      actionsTaken: [
        'The implementor found no changes to make.',
        'Task transitioned back to `open`.',
      ],
      next: 'Review the task description and decide next steps. The task may need more context or a different approach.',
    };
  }

  // --- Merged: ready_to_merge → done ---
  if (fromStatus === 'ready_to_merge' && toStatus === 'done') {
    return {
      actionsTaken: [
        'PR merged successfully.',
        'Task transitioned to `done`.',
      ],
      next: 'Task is complete. Inform the user that the PR has been merged.',
    };
  }

  // --- Fallback for any unmatched transition ---
  return {
    actionsTaken: [
      `Task transitioned from \`${fromStatus}\` to \`${toStatus}\`.`,
    ],
    next: 'No specific follow-up action required. Check task status if needed.',
  };
}

/**
 * Format the full system notification message with actions taken and next steps.
 */
export function formatSystemNotification(params: {
  agentType: string;
  taskTitle: string;
  outcome: string;
  fromStatus: string;
  toStatus: string;
  summary?: string;
  prLink?: string;
}): string {
  const { agentType, taskTitle, outcome, fromStatus, toStatus, summary, prLink } = params;

  const ctx = buildPipelineNotificationContext(outcome, agentType, fromStatus, toStatus, { prLink });

  const lines: string[] = [
    `[System Notification] The ${agentType} agent for task "${taskTitle}" has completed with outcome "${outcome}". ` +
    `Status: ${fromStatus} → ${toStatus}.` +
    (summary ? ` Summary: ${summary}` : ''),
    '',
    '**Actions taken:**',
    ...ctx.actionsTaken.map(a => `- ${a}`),
    '',
    `**Next:** ${ctx.next}`,
  ];

  return lines.join('\n');
}
