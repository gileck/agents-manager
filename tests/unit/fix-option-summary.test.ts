import { describe, it, expect } from 'vitest';
import { buildFixOptionSummary } from '../../src/renderer/utils/fix-option-summary';

describe('buildFixOptionSummary', () => {
  it('includes label and full description when description is present', () => {
    const option = {
      id: 'opt-l',
      label: 'L — Architectural Fix: Standardize hierarchical branch naming',
      description: 'Effort: ~4h\n\nApproach: Refactor branch naming to use hierarchical convention.\n\nConcerns: Requires migration of existing branches.',
    };
    const result = buildFixOptionSummary(option);
    expect(result).toBe(
      'Selected fix option: L — Architectural Fix: Standardize hierarchical branch naming\n\n' +
      'Description:\n' +
      'Effort: ~4h\n\nApproach: Refactor branch naming to use hierarchical convention.\n\nConcerns: Requires migration of existing branches.',
    );
  });

  it('includes label and description for a recommended option', () => {
    const option = {
      id: 'opt-s',
      label: 'S — Quick Fix',
      description: 'Simple one-line change.',
      recommended: true,
    };
    const result = buildFixOptionSummary(option);
    expect(result).toContain('Selected fix option: S — Quick Fix');
    expect(result).toContain('Description:\nSimple one-line change.');
  });

  it('falls back to just the label when description is empty', () => {
    const option = {
      id: 'opt-m',
      label: 'M — Moderate Fix: Update config schema',
      description: '',
    };
    const result = buildFixOptionSummary(option);
    expect(result).toBe('M — Moderate Fix: Update config schema');
  });
});
