import { describe, it, expect } from 'vitest';
import { validateOutcomePayload, OUTCOME_SCHEMAS } from '../../src/main/handlers/outcome-schemas';

describe('validateOutcomePayload', () => {
  // ============================================
  // Signal-only outcomes (no payload needed)
  // ============================================
  describe('Signal-only outcomes', () => {
    const signalOutcomes = [
      'plan_complete',
      'pr_ready',
      'approved',
      'failed',
      'interrupted',
      'no_changes',
      'conflicts_detected',
      'investigation_complete',
      'design_ready',
      'reproduced',
      'cannot_reproduce',
    ];

    for (const outcome of signalOutcomes) {
      it(`should validate "${outcome}" with null payload as valid`, () => {
        const result = validateOutcomePayload(outcome, null);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it(`should validate "${outcome}" with undefined payload as valid`, () => {
        const result = validateOutcomePayload(outcome, undefined);
        expect(result.valid).toBe(true);
      });

      it(`should validate "${outcome}" with empty object payload as valid`, () => {
        const result = validateOutcomePayload(outcome, {});
        expect(result.valid).toBe(true);
      });
    }

    it('should confirm all signal-only outcomes have null schema', () => {
      for (const outcome of signalOutcomes) {
        expect(OUTCOME_SCHEMAS[outcome]).toBeDefined();
        expect(OUTCOME_SCHEMAS[outcome].schema).toBeNull();
      }
    });
  });

  // ============================================
  // needs_info outcome
  // ============================================
  describe('needs_info outcome', () => {
    it('should validate with valid payload', () => {
      const result = validateOutcomePayload('needs_info', {
        questions: ['What is the database?', 'Which auth provider?'],
      });
      expect(result.valid).toBe(true);
    });

    it('should invalidate with missing required field (questions)', () => {
      const result = validateOutcomePayload('needs_info', {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing required field');
      expect(result.error).toContain('questions');
    });

    it('should invalidate with wrong field type (questions as string)', () => {
      const result = validateOutcomePayload('needs_info', {
        questions: 'this should be an array',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be array');
    });

    it('should invalidate with null payload', () => {
      const result = validateOutcomePayload('needs_info', null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires an object payload');
    });
  });

  // ============================================
  // options_proposed outcome
  // ============================================
  describe('options_proposed outcome', () => {
    it('should validate with valid payload', () => {
      const result = validateOutcomePayload('options_proposed', {
        summary: 'Choose a database',
        options: ['PostgreSQL', 'MySQL', 'MongoDB'],
      });
      expect(result.valid).toBe(true);
    });

    it('should invalidate with missing summary', () => {
      const result = validateOutcomePayload('options_proposed', {
        options: ['A', 'B'],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing required field');
      expect(result.error).toContain('summary');
    });

    it('should invalidate with missing options', () => {
      const result = validateOutcomePayload('options_proposed', {
        summary: 'Pick one',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing required field');
      expect(result.error).toContain('options');
    });

    it('should invalidate with wrong type for summary (number)', () => {
      const result = validateOutcomePayload('options_proposed', {
        summary: 123,
        options: ['A'],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be string');
    });

    it('should invalidate with wrong type for options (string)', () => {
      const result = validateOutcomePayload('options_proposed', {
        summary: 'Pick',
        options: 'not an array',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be array');
    });
  });

  // ============================================
  // changes_requested outcome
  // ============================================
  describe('changes_requested outcome', () => {
    it('should validate with valid payload', () => {
      const result = validateOutcomePayload('changes_requested', {
        summary: 'Fix linting errors',
        comments: [{ file: 'app.ts', line: 10, message: 'missing semicolon' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should invalidate with missing summary', () => {
      const result = validateOutcomePayload('changes_requested', {
        comments: [],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('summary');
    });

    it('should invalidate with missing comments', () => {
      const result = validateOutcomePayload('changes_requested', {
        summary: 'Fix issues',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('comments');
    });

    it('should invalidate with wrong type for comments (object instead of array)', () => {
      const result = validateOutcomePayload('changes_requested', {
        summary: 'Fix',
        comments: { issue: 'bad' },
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be array');
    });
  });

  // ============================================
  // Unknown outcomes
  // ============================================
  describe('Unknown outcomes', () => {
    it('should return invalid for totally unknown outcome', () => {
      const result = validateOutcomePayload('totally_unknown', null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown outcome');
      expect(result.error).toContain('totally_unknown');
    });

    it('should return invalid for empty string outcome', () => {
      const result = validateOutcomePayload('', null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown outcome');
    });
  });

  // ============================================
  // Non-object payloads for schema-based outcomes
  // ============================================
  describe('Non-object payloads', () => {
    it('should invalidate string payload', () => {
      const result = validateOutcomePayload('needs_info', 'some string');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires an object payload');
    });

    it('should invalidate number payload', () => {
      const result = validateOutcomePayload('needs_info', 42);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires an object payload');
    });

    it('should invalidate array payload (treated as object missing required fields)', () => {
      const result = validateOutcomePayload('needs_info', ['question1']);
      expect(result.valid).toBe(false);
      // Arrays pass the typeof === 'object' check, so they fail on missing required fields
      expect(result.error).toContain('missing required field');
    });

    it('should invalidate boolean payload', () => {
      const result = validateOutcomePayload('needs_info', true);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires an object payload');
    });
  });

  // ============================================
  // Edge cases
  // ============================================
  describe('Edge cases', () => {
    it('should allow extra fields in payload (no strict mode)', () => {
      const result = validateOutcomePayload('needs_info', {
        questions: ['What version?'],
        extraField: 'should be allowed',
      });
      expect(result.valid).toBe(true);
    });

    it('should validate with empty arrays for required array fields', () => {
      const result = validateOutcomePayload('needs_info', {
        questions: [],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate with empty string for required string fields', () => {
      const result = validateOutcomePayload('options_proposed', {
        summary: '',
        options: [],
      });
      expect(result.valid).toBe(true);
    });

    it('should verify OUTCOME_SCHEMAS contains all expected outcomes', () => {
      const expectedOutcomes = [
        'needs_info',
        'options_proposed',
        'changes_requested',
        'failed',
        'interrupted',
        'no_changes',
        'conflicts_detected',
        'plan_complete',
        'investigation_complete',
        'pr_ready',
        'approved',
        'design_ready',
        'reproduced',
        'cannot_reproduce',
      ];
      for (const outcome of expectedOutcomes) {
        expect(OUTCOME_SCHEMAS[outcome]).toBeDefined();
      }
    });
  });
});
