// Token-to-cost utility functions
// Default pricing: Sonnet 4 rates ($3/$15 per MTok input/output)
// since the specific model is not stored per-run.

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Pattern-based pricing table. Each entry's `pattern` is matched as a
 * case-insensitive substring against the full model identifier (e.g.
 * "claude-sonnet-4-20250514" matches "sonnet"). Entries are evaluated
 * in order; the first match wins. Keep more-specific patterns first if
 * overlap is possible.
 */
export const MODEL_PRICING_TABLE: Array<{ pattern: string; pricing: ModelPricing }> = [
  // Versioned entries (more-specific, evaluated first)
  { pattern: 'claude-3-5-sonnet', pricing: { inputPerMTok: 3,    outputPerMTok: 15 } },
  { pattern: 'claude-3-5-haiku',  pricing: { inputPerMTok: 0.80, outputPerMTok: 4 } },
  { pattern: 'claude-3-haiku',    pricing: { inputPerMTok: 0.25, outputPerMTok: 1.25 } },
  // Generic family patterns (fallback)
  { pattern: 'opus',   pricing: { inputPerMTok: 15,   outputPerMTok: 75 } },
  { pattern: 'sonnet', pricing: { inputPerMTok: 3,    outputPerMTok: 15 } },
  { pattern: 'haiku',  pricing: { inputPerMTok: 0.25, outputPerMTok: 1.25 } },
];

const DEFAULT_PRICING: ModelPricing = MODEL_PRICING_TABLE.find(e => e.pattern === 'sonnet')!.pricing;

/**
 * Look up pricing for a model identifier using substring matching.
 * Returns the first entry whose pattern appears in the model string
 * (case-insensitive), or `undefined` if no match is found.
 */
function findPricing(model: string): ModelPricing | undefined {
  const lower = model.toLowerCase();
  return MODEL_PRICING_TABLE.find(entry => lower.includes(entry.pattern))?.pricing;
}

/**
 * Calculate cost in dollars from token counts.
 */
export function calculateCost(
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  model?: string
): number {
  const pricing = (model && findPricing(model)) || DEFAULT_PRICING;
  const input = Number(inputTokens) || 0;
  const output = Number(outputTokens) || 0;
  return (input / 1_000_000) * pricing.inputPerMTok + (output / 1_000_000) * pricing.outputPerMTok;
}

/**
 * Format a dollar amount for display.
 */
export function formatCost(dollars: number): string {
  if (!Number.isFinite(dollars) || dollars === 0) return '$0.00';
  if (dollars < 0.01) {
    return `$${dollars.toFixed(4)}`;
  }
  return `$${dollars.toFixed(2)}`;
}

/**
 * Format a token count with locale-aware thousand separators.
 */
export function formatTokens(count: number | null | undefined): string {
  return (Number(count) || 0).toLocaleString();
}
