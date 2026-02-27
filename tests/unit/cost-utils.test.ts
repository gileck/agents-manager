import { describe, it, expect } from 'vitest';
import {
  calculateCost,
  formatCost,
  formatTokens,
  MODEL_PRICING_TABLE,
} from '../../src/shared/cost-utils';

describe('cost-utils', () => {
  describe('calculateCost', () => {
    it('uses default (sonnet) pricing when no model is specified', () => {
      // Sonnet pricing: $3 input / $15 output per million tokens
      const cost = calculateCost(1_000_000, 1_000_000);
      expect(cost).toBe(3 + 15);
    });

    it('matches opus model via substring', () => {
      // Opus pricing: $15 input / $75 output per million tokens
      const cost = calculateCost(1_000_000, 1_000_000, 'claude-opus-4-20250514');
      expect(cost).toBe(15 + 75);
    });

    it('matches sonnet model via substring', () => {
      const cost = calculateCost(1_000_000, 1_000_000, 'claude-sonnet-4-20250514');
      expect(cost).toBe(3 + 15);
    });

    it('matches haiku model via substring', () => {
      // Claude 3.5 Haiku pricing: $0.80 input / $4 output per million tokens
      const cost = calculateCost(1_000_000, 1_000_000, 'claude-3-5-haiku-20241022');
      expect(cost).toBe(0.80 + 4);
    });

    it('is case-insensitive for model matching', () => {
      const cost = calculateCost(1_000_000, 0, 'Claude-OPUS-4');
      expect(cost).toBe(15);
    });

    it('falls back to default pricing for unknown models', () => {
      const cost = calculateCost(1_000_000, 1_000_000, 'gpt-4o');
      // Should use sonnet (default) pricing
      expect(cost).toBe(3 + 15);
    });

    it('handles null/undefined token counts', () => {
      expect(calculateCost(null, undefined)).toBe(0);
      expect(calculateCost(null, 1_000_000)).toBe(15);
      expect(calculateCost(1_000_000, null)).toBe(3);
    });

    it('handles zero tokens', () => {
      expect(calculateCost(0, 0)).toBe(0);
    });

    it('calculates fractional token costs correctly', () => {
      // 500 input tokens with sonnet pricing: (500/1_000_000)*3 = 0.0015
      const cost = calculateCost(500, 0, 'sonnet');
      expect(cost).toBeCloseTo(0.0015, 6);
    });
  });

  describe('formatCost', () => {
    it('formats zero as $0.00', () => {
      expect(formatCost(0)).toBe('$0.00');
    });

    it('formats normal amounts with 2 decimal places', () => {
      expect(formatCost(1.5)).toBe('$1.50');
      expect(formatCost(18)).toBe('$18.00');
      expect(formatCost(0.99)).toBe('$0.99');
    });

    it('formats very small amounts with 4 decimal places', () => {
      expect(formatCost(0.005)).toBe('$0.0050');
      expect(formatCost(0.0015)).toBe('$0.0015');
    });

    it('handles non-finite numbers', () => {
      expect(formatCost(NaN)).toBe('$0.00');
      expect(formatCost(Infinity)).toBe('$0.00');
      expect(formatCost(-Infinity)).toBe('$0.00');
    });

    it('uses 2 decimals for amounts at the threshold (0.01)', () => {
      expect(formatCost(0.01)).toBe('$0.01');
    });
  });

  describe('formatTokens', () => {
    it('formats zero', () => {
      expect(formatTokens(0)).toBe('0');
    });

    it('formats with locale separators', () => {
      const result = formatTokens(1234567);
      // toLocaleString output depends on locale, but should contain digits
      expect(result).toMatch(/1.*234.*567/);
    });

    it('handles null/undefined', () => {
      expect(formatTokens(null)).toBe('0');
      expect(formatTokens(undefined)).toBe('0');
    });
  });

  describe('MODEL_PRICING_TABLE', () => {
    it('contains entries for opus, sonnet, and haiku', () => {
      const patterns = MODEL_PRICING_TABLE.map((e) => e.pattern);
      expect(patterns).toContain('opus');
      expect(patterns).toContain('sonnet');
      expect(patterns).toContain('haiku');
    });

    it('first-match-wins ordering (opus before sonnet before haiku)', () => {
      const patterns = MODEL_PRICING_TABLE.map((e) => e.pattern);
      expect(patterns.indexOf('opus')).toBeLessThan(patterns.indexOf('sonnet'));
      expect(patterns.indexOf('sonnet')).toBeLessThan(patterns.indexOf('haiku'));
    });
  });
});
