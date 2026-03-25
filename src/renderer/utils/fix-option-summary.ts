import type { ProposedFixOption } from '../../shared/types';

/**
 * Build an enriched summary string for a `fix_option_selected` context entry.
 * Includes the option label and, when available, the full description so
 * downstream agents (planner, implementor) get complete visibility into the
 * selected approach without needing to cross-reference `fix_options_proposed`.
 */
export function buildFixOptionSummary(option: ProposedFixOption): string {
  if (option.description) {
    return `Selected fix option: ${option.label}\n\nDescription:\n${option.description}`;
  }
  return option.label;
}
