// Token-to-cost utility functions

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

/**
 * Pattern-based pricing table. Each entry's `pattern` is matched as a
 * case-insensitive substring against the full model identifier (e.g.
 * "claude-sonnet-4-20250514" matches "sonnet"). Entries are evaluated
 * in order; the first match wins. Keep more-specific patterns first if
 * overlap is possible.
 */
export const MODEL_PRICING_TABLE: Array<{ pattern: string; pricing: ModelPricing }> = [
  // ── Claude (versioned, most-specific first) ──
  // Claude cache: read = 10% of input, write = 125% of input
  { pattern: 'claude-3-haiku',    pricing: { inputPerMTok: 0.25, outputPerMTok: 1.25,  cacheReadPerMTok: 0.025,  cacheWritePerMTok: 0.3125 } },
  { pattern: 'claude-3-5-haiku',  pricing: { inputPerMTok: 0.80, outputPerMTok: 4,     cacheReadPerMTok: 0.08,   cacheWritePerMTok: 1 } },
  { pattern: 'claude-3-5-sonnet', pricing: { inputPerMTok: 3,    outputPerMTok: 15,    cacheReadPerMTok: 0.30,   cacheWritePerMTok: 3.75 } },
  { pattern: 'haiku-4-5',         pricing: { inputPerMTok: 1,    outputPerMTok: 5,     cacheReadPerMTok: 0.10,   cacheWritePerMTok: 1.25 } },
  { pattern: 'haiku-3-5',         pricing: { inputPerMTok: 0.80, outputPerMTok: 4,     cacheReadPerMTok: 0.08,   cacheWritePerMTok: 1 } },
  // Opus 4/4.1/3 = $15/$75; Opus 4.5/4.6 = $5/$25
  { pattern: 'opus-4-6',          pricing: { inputPerMTok: 5,    outputPerMTok: 25,    cacheReadPerMTok: 0.50,   cacheWritePerMTok: 6.25 } },
  { pattern: 'opus-4-5',          pricing: { inputPerMTok: 5,    outputPerMTok: 25,    cacheReadPerMTok: 0.50,   cacheWritePerMTok: 6.25 } },
  { pattern: 'opus-4-1',          pricing: { inputPerMTok: 15,   outputPerMTok: 75,    cacheReadPerMTok: 1.50,   cacheWritePerMTok: 18.75 } },
  { pattern: 'opus-4-0',          pricing: { inputPerMTok: 15,   outputPerMTok: 75,    cacheReadPerMTok: 1.50,   cacheWritePerMTok: 18.75 } },
  { pattern: 'opus-3',            pricing: { inputPerMTok: 15,   outputPerMTok: 75,    cacheReadPerMTok: 1.50,   cacheWritePerMTok: 18.75 } },
  { pattern: '4.6-opus',          pricing: { inputPerMTok: 5,    outputPerMTok: 25,    cacheReadPerMTok: 0.50,   cacheWritePerMTok: 6.25 } },
  { pattern: '4.5-opus',          pricing: { inputPerMTok: 5,    outputPerMTok: 25,    cacheReadPerMTok: 0.50,   cacheWritePerMTok: 6.25 } },
  // ── Claude generic family (fallback for current-gen models) ──
  { pattern: 'opus-4',            pricing: { inputPerMTok: 15,   outputPerMTok: 75,    cacheReadPerMTok: 1.50,   cacheWritePerMTok: 18.75 } },
  { pattern: 'opus',              pricing: { inputPerMTok: 5,    outputPerMTok: 25,    cacheReadPerMTok: 0.50,   cacheWritePerMTok: 6.25 } },
  { pattern: 'sonnet',            pricing: { inputPerMTok: 3,    outputPerMTok: 15,    cacheReadPerMTok: 0.30,   cacheWritePerMTok: 3.75 } },
  { pattern: 'haiku',             pricing: { inputPerMTok: 1,    outputPerMTok: 5,     cacheReadPerMTok: 0.10,   cacheWritePerMTok: 1.25 } },

  // ── OpenAI Codex / GPT ──
  // OpenAI cache: read = 50% of input, no write premium
  { pattern: 'codex-mini',        pricing: { inputPerMTok: 1.50, outputPerMTok: 6,     cacheReadPerMTok: 0.75,   cacheWritePerMTok: 1.50 } },
  { pattern: 'gpt-5.3-codex',     pricing: { inputPerMTok: 1.75, outputPerMTok: 14,    cacheReadPerMTok: 0.875,  cacheWritePerMTok: 1.75 } },
  { pattern: 'gpt-5.2-codex',     pricing: { inputPerMTok: 1.75, outputPerMTok: 14,    cacheReadPerMTok: 0.875,  cacheWritePerMTok: 1.75 } },
  { pattern: 'gpt-5.1-codex',     pricing: { inputPerMTok: 1.25, outputPerMTok: 10,    cacheReadPerMTok: 0.625,  cacheWritePerMTok: 1.25 } },
  { pattern: 'gpt-5-codex',       pricing: { inputPerMTok: 1.25, outputPerMTok: 10,    cacheReadPerMTok: 0.625,  cacheWritePerMTok: 1.25 } },
  { pattern: 'gpt-5.3',           pricing: { inputPerMTok: 1.75, outputPerMTok: 14,    cacheReadPerMTok: 0.875,  cacheWritePerMTok: 1.75 } },
  { pattern: 'gpt-5.2',           pricing: { inputPerMTok: 1.75, outputPerMTok: 14,    cacheReadPerMTok: 0.875,  cacheWritePerMTok: 1.75 } },
  { pattern: 'gpt-5.1',           pricing: { inputPerMTok: 1.25, outputPerMTok: 10,    cacheReadPerMTok: 0.625,  cacheWritePerMTok: 1.25 } },
  { pattern: 'gpt-5',             pricing: { inputPerMTok: 1.25, outputPerMTok: 10,    cacheReadPerMTok: 0.625,  cacheWritePerMTok: 1.25 } },

  // ── Google Gemini ──
  // Gemini cache: read = 25% of input, no write premium
  { pattern: 'gemini-2.5-flash',  pricing: { inputPerMTok: 0.30, outputPerMTok: 2.50,  cacheReadPerMTok: 0.075,  cacheWritePerMTok: 0.30 } },
  { pattern: 'gemini-2.5-pro',    pricing: { inputPerMTok: 1.25, outputPerMTok: 10,    cacheReadPerMTok: 0.3125, cacheWritePerMTok: 1.25 } },

  // ── Cursor ──
  { pattern: 'composer',          pricing: { inputPerMTok: 1.25, outputPerMTok: 10,    cacheReadPerMTok: 0.125,  cacheWritePerMTok: 1.5625 } },
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
 * Calculate cost in dollars from token counts (fallback when totalCostUsd is not available).
 */
export function calculateCost(
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  model?: string,
  cacheReadTokens?: number | null,
  cacheWriteTokens?: number | null,
): number {
  const pricing = (model && findPricing(model)) || DEFAULT_PRICING;
  const input = Number(inputTokens) || 0;
  const output = Number(outputTokens) || 0;
  const cacheRead = Number(cacheReadTokens) || 0;
  const cacheWrite = Number(cacheWriteTokens) || 0;
  // Use explicit cache rates if available, otherwise derive from input rate
  // (Anthropic default: read = 10% of input, write = 125% of input)
  const cacheReadRate = pricing.cacheReadPerMTok ?? pricing.inputPerMTok * 0.1;
  const cacheWriteRate = pricing.cacheWritePerMTok ?? pricing.inputPerMTok * 1.25;
  return (input / 1_000_000) * pricing.inputPerMTok
    + (output / 1_000_000) * pricing.outputPerMTok
    + (cacheRead / 1_000_000) * cacheReadRate
    + (cacheWrite / 1_000_000) * cacheWriteRate;
}

/**
 * Returns the best available cost estimate. Prefers the authoritative
 * totalCostUsd from the SDK when available; falls back to manual
 * calculation from token counts.
 */
export function getEffectiveCost(opts: {
  totalCostUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  model?: string;
}): number {
  if (opts.totalCostUsd != null && opts.totalCostUsd > 0) {
    return opts.totalCostUsd;
  }
  return calculateCost(opts.inputTokens, opts.outputTokens, opts.model, opts.cacheReadTokens, opts.cacheWriteTokens);
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
