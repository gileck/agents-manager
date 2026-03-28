/**
 * Configuration mapping task statuses to contextual toast actions.
 *
 * Each status maps to an array of action descriptors. The hook and toast
 * component use these descriptors to render the right buttons and wire
 * up the correct navigation or API calls.
 */

export type ToastActionKind =
  | 'view'
  | 'review'
  | 'approve'
  | 'merge'
  | 'retry';

export interface ToastActionDescriptor {
  kind: ToastActionKind;
  label: string;
  /** For 'review' actions, the tab or section to focus on the task detail page. */
  tab?: string;
  /** For 'approve' actions, the target status to transition to. */
  transitionTo?: string;
}

/**
 * Map from pipeline status name → array of action descriptors.
 *
 * The first action is rendered as the primary "action" button; the second
 * (if present) is rendered as the "cancel" (secondary) button in Sonner.
 *
 * Statuses not listed here fall back to a single "View" action.
 */
export const STATUS_TOAST_ACTIONS: Record<string, ToastActionDescriptor[]> = {
  // Agent-running phases — just navigate to the task
  investigating: [{ kind: 'view', label: 'View' }],
  triaging: [{ kind: 'view', label: 'View' }],
  ux_designing: [{ kind: 'view', label: 'View' }],
  designing: [{ kind: 'view', label: 'View' }],
  planning: [{ kind: 'view', label: 'View' }],
  implementing: [{ kind: 'view', label: 'View' }],

  // Human review gates
  triage_review: [
    { kind: 'review', label: 'Review Triage', tab: 'overview' },
    { kind: 'view', label: 'View' },
  ],
  investigation_review: [
    { kind: 'review', label: 'Review', tab: 'investigation' },
    { kind: 'approve', label: 'Approve & Implement', transitionTo: 'implementing' },
  ],
  ux_design_review: [
    { kind: 'review', label: 'Review UX', tab: 'ux-design' },
    { kind: 'view', label: 'View' },
  ],
  design_review: [
    { kind: 'review', label: 'Review Design', tab: 'design' },
    { kind: 'approve', label: 'Approve & Plan', transitionTo: 'planning' },
  ],
  plan_review: [
    { kind: 'review', label: 'Review Plan', tab: 'plan' },
    { kind: 'approve', label: 'Approve & Implement', transitionTo: 'implementing' },
  ],
  // pr_review approve has multiple guarded variants (has_following_phases,
  // has_pending_phases, default) so we navigate to the task detail page
  // and let the user pick the right action from the full UI.
  pr_review: [
    { kind: 'review', label: 'Review PR' },
    { kind: 'view', label: 'Approve\u2026' },
  ],

  // Ready to merge
  ready_to_merge: [
    { kind: 'merge', label: 'Merge', transitionTo: 'done' },
    { kind: 'view', label: 'View' },
  ],

  // Terminal / special
  done: [{ kind: 'view', label: 'View' }],
  closed: [{ kind: 'view', label: 'View' }],
  needs_info: [{ kind: 'view', label: 'View' }],
};

/** Default actions for statuses not explicitly mapped. */
export const DEFAULT_TOAST_ACTIONS: ToastActionDescriptor[] = [
  { kind: 'view', label: 'View' },
];

/** Auto-dismiss duration for status-change toasts (ms). */
export const TOAST_DURATION_MS = 8000;
