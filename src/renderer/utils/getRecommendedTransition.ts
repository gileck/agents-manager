import type { Transition, TaskType, TaskSize, TaskComplexity } from '../../shared/types';

const ESCAPE_STATUSES = new Set(['backlog', 'closed']);

export function isEscapeTransition(t: Transition): boolean {
  return ESCAPE_STATUSES.has(t.to);
}

/**
 * Determine the recommended next transition based on task type × size/complexity.
 *
 * Mapping:
 *   bug + any          → investigating
 *   feature + xs/sm    → implementing
 *   feature + md       → planning
 *   feature + lg/xl    → designing
 *   feature + high     → designing
 *   improvement + sm   → implementing
 *   improvement + md+  → planning
 *   fallback           → first non-escape transition
 */
export function getRecommendedTransition(
  task: { type?: TaskType | null; size?: TaskSize | null; complexity?: TaskComplexity | null },
  transitions: Transition[]
): Transition | null {
  if (!transitions.length) return null;

  const forwardTransitions = transitions.filter((t) => !isEscapeTransition(t));
  if (!forwardTransitions.length) return transitions[0];

  const find = (toStatus: string) => forwardTransitions.find((t) => t.to === toStatus) ?? null;

  const { type, size, complexity } = task;

  if (type === 'bug') {
    return find('investigating') ?? forwardTransitions[0];
  }

  if (type === 'feature') {
    const isLarge = size === 'lg' || size === 'xl' || complexity === 'high';
    const isMedium = size === 'md' || complexity === 'medium';
    const isSmall = size === 'xs' || size === 'sm';
    if (isLarge) return find('designing') ?? forwardTransitions[0];
    if (isMedium) return find('planning') ?? forwardTransitions[0];
    if (isSmall) return find('implementing') ?? forwardTransitions[0];
    // unknown size/complexity — fall through to first forward
  }

  if (type === 'improvement') {
    const isSmall = size === 'xs' || size === 'sm';
    if (isSmall) return find('implementing') ?? forwardTransitions[0];
    // md, lg, xl, or unknown size → planning
    if (size === 'md' || size === 'lg' || size === 'xl') {
      return find('planning') ?? forwardTransitions[0];
    }
  }

  // Fallback: first non-escape transition
  return forwardTransitions[0];
}
