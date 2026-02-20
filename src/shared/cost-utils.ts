// Token-to-cost utility functions
// Default pricing: Sonnet 4 rates ($3/$15 per MTok input/output)
// since the specific model is not stored per-run.

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'sonnet': { inputPerMTok: 3, outputPerMTok: 15 },
  'opus': { inputPerMTok: 15, outputPerMTok: 75 },
  'haiku': { inputPerMTok: 0.25, outputPerMTok: 1.25 },
};

const DEFAULT_PRICING = MODEL_PRICING['sonnet'];

/**
 * Calculate cost in dollars from token counts.
 */
export function calculateCost(
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  model?: string
): number {
  const pricing = (model && MODEL_PRICING[model]) || DEFAULT_PRICING;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return (input / 1_000_000) * pricing.inputPerMTok + (output / 1_000_000) * pricing.outputPerMTok;
}

/**
 * Format a dollar amount for display.
 */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0.00';
  if (dollars < 0.01) {
    return `$${dollars.toFixed(4)}`;
  }
  return `$${dollars.toFixed(2)}`;
}

/**
 * Format a token count with locale-aware thousand separators.
 */
export function formatTokens(count: number | null | undefined): string {
  return (count ?? 0).toLocaleString();
}
