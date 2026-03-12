import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { AgentChatMessage, AgentRun } from '../../../shared/types';
import { getEffectiveCost, findPricing, formatCost } from '../../../shared/cost-utils';

interface PerTurnUsage {
  turn: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: number;
}

interface ContextSidebarProps {
  messages: AgentChatMessage[];
  run?: AgentRun | null;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    totalCostUsd?: number;
    lastContextInputTokens?: number | null;
    contextWindow?: number | null;
  };
  perTurnUsage?: PerTurnUsage[];
  agentLib?: string;
  model?: string;
  modelLabel?: string;
  systemPromptAppend?: string | null;
  onSystemPromptAppendChange?: (value: string | null) => void;
}

const DEFAULT_CONTEXT_WINDOW = 200_000;

export function ContextSidebar({ messages, run, tokenUsage, perTurnUsage, agentLib, model, modelLabel, systemPromptAppend, onSystemPromptAppendChange }: ContextSidebarProps) {
  const [costExpanded, setCostExpanded] = useState(false);

  // Use the latest usage message (SDK reports cumulative totals)
  let totalInput = 0;
  let totalOutput = 0;

  if (tokenUsage) {
    // Use pre-computed token usage (from ChatPage)
    totalInput = tokenUsage.inputTokens;
    totalOutput = tokenUsage.outputTokens;
  } else {
    for (const msg of messages) {
      if (msg.type === 'usage') {
        totalInput = msg.inputTokens;
        totalOutput = msg.outputTokens;
      }
    }
  }

  // Also use run-level token counts if available
  if (run?.costInputTokens) totalInput = Math.max(totalInput, run.costInputTokens);
  if (run?.costOutputTokens) totalOutput = Math.max(totalOutput, run.costOutputTokens);

  const totalTokens = totalInput + totalOutput;

  // Merge cache tokens from tokenUsage (DB sums) and run (agent run level), taking the max
  const cacheRead = Math.max(tokenUsage?.cacheReadInputTokens ?? 0, run?.cacheReadInputTokens ?? 0);
  const cacheWrite = Math.max(tokenUsage?.cacheCreationInputTokens ?? 0, run?.cacheCreationInputTokens ?? 0);
  const hasCacheInfo = cacheRead > 0 || cacheWrite > 0;

  // Use totalCostUsd from the run if available (authoritative SDK cost),
  // otherwise fall back to manual calculation from token counts.
  const estimatedCost = getEffectiveCost({
    totalCostUsd: run?.totalCostUsd,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    model: run?.model ?? model ?? undefined,
  });
  // Derive the effective context window size from SDK modelUsage when available,
  // falling back to the hardcoded default.
  const effectiveContextWindow = (tokenUsage?.contextWindow && tokenUsage.contextWindow > 0)
    ? tokenUsage.contextWindow
    : DEFAULT_CONTEXT_WINDOW;
  // Use the last turn's context size (actual input to the last API call) when available,
  // since that reflects true context window utilization. Fall back to cumulative sum otherwise.
  const contextWindowTokens = tokenUsage?.lastContextInputTokens ?? totalInput;
  const contextUsagePercent = Math.min((contextWindowTokens / effectiveContextWindow) * 100, 100);

  // Look up per-token pricing for the cost breakdown
  const effectiveModel = run?.model ?? model;
  const pricing = effectiveModel ? findPricing(effectiveModel) : undefined;

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  // Compute per-category cost breakdown
  const categoryBreakdown = pricing ? (() => {
    const cacheReadRate = pricing.cacheReadPerMTok ?? pricing.inputPerMTok * 0.1;
    const cacheWriteRate = pricing.cacheWritePerMTok ?? pricing.inputPerMTok * 1.25;
    return [
      { label: 'Input', tokens: totalInput, cost: (totalInput / 1_000_000) * pricing.inputPerMTok },
      { label: 'Output', tokens: totalOutput, cost: (totalOutput / 1_000_000) * pricing.outputPerMTok },
      ...(cacheRead > 0 ? [{ label: 'Cache read', tokens: cacheRead, cost: (cacheRead / 1_000_000) * cacheReadRate }] : []),
      ...(cacheWrite > 0 ? [{ label: 'Cache write', tokens: cacheWrite, cost: (cacheWrite / 1_000_000) * cacheWriteRate }] : []),
    ];
  })() : null;

  return (
    <div className="p-4 space-y-4 border-b border-border">
      {/* Agent Config section */}
      {agentLib && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Agent Config</h3>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Engine</span>
            <span className="font-mono text-xs">{agentLib}</span>
          </div>
          {model && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono text-xs">{modelLabel || model}</span>
            </div>
          )}
          <hr className="border-border" />
        </div>
      )}

      <h3 className="text-sm font-semibold text-foreground">Token Usage</h3>

      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Input tokens</span>
          <span className="font-mono">{formatNumber(totalInput)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Output tokens</span>
          <span className="font-mono">{formatNumber(totalOutput)}</span>
        </div>
        {hasCacheInfo && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cache read</span>
              <span className="font-mono">{formatNumber(cacheRead)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cache write</span>
              <span className="font-mono">{formatNumber(cacheWrite)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between text-sm font-medium">
          <span>Total</span>
          <span className="font-mono">{formatNumber(totalTokens)}</span>
        </div>

        <hr className="border-border" />

        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Est. cost</span>
          <span className="font-mono">${estimatedCost.toFixed(4)}</span>
        </div>

        {/* Expandable cost breakdown */}
        {(categoryBreakdown || (perTurnUsage && perTurnUsage.length > 0)) && (
          <>
            <button
              onClick={() => setCostExpanded(!costExpanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <span style={{ display: 'inline-block', width: '12px', textAlign: 'center', fontSize: '10px' }}>
                {costExpanded ? '▼' : '▶'}
              </span>
              <span>Cost breakdown</span>
            </button>

            {costExpanded && (
              <div className="space-y-3 pl-1">
                {/* Per-category cost breakdown */}
                {categoryBreakdown && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground mb-1">By category</div>
                    {categoryBreakdown.map(({ label, tokens, cost }) => (
                      <div key={label} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{label} ({formatNumber(tokens)})</span>
                        <span className="font-mono">{formatCost(cost)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Per-turn table */}
                {perTurnUsage && perTurnUsage.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">By turn</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left font-medium py-0.5 pr-2">#</th>
                            <th className="text-right font-medium py-0.5 px-1">Input</th>
                            <th className="text-right font-medium py-0.5 px-1">Output</th>
                            <th className="text-right font-medium py-0.5 px-1">Cache</th>
                            <th className="text-right font-medium py-0.5 pl-1">Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {perTurnUsage.map((t) => {
                            const turnCost = getEffectiveCost({
                              totalCostUsd: t.totalCostUsd,
                              inputTokens: t.inputTokens,
                              outputTokens: t.outputTokens,
                              cacheReadTokens: t.cacheReadTokens,
                              cacheWriteTokens: t.cacheWriteTokens,
                              model: effectiveModel,
                            });
                            const totalCache = t.cacheReadTokens + t.cacheWriteTokens;
                            return (
                              <tr key={t.turn} className="text-foreground">
                                <td className="py-0.5 pr-2 text-muted-foreground">{t.turn}</td>
                                <td className="text-right py-0.5 px-1 font-mono">{formatNumber(t.inputTokens)}</td>
                                <td className="text-right py-0.5 px-1 font-mono">{formatNumber(t.outputTokens)}</td>
                                <td className="text-right py-0.5 px-1 font-mono">{totalCache > 0 ? formatNumber(totalCache) : '—'}</td>
                                <td className="text-right py-0.5 pl-1 font-mono">{formatCost(turnCost)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <hr className="border-border" />

        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Context window</span>
            <span>{contextUsagePercent.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${contextUsagePercent}%`,
                backgroundColor: contextUsagePercent > 80 ? '#ef4444' : contextUsagePercent > 50 ? '#f59e0b' : '#22c55e',
              }}
            />
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {formatNumber(contextWindowTokens)} / {formatNumber(effectiveContextWindow)}
          </div>
        </div>
      </div>

      {/* Custom Instructions section */}
      {onSystemPromptAppendChange && (
        <CustomInstructionsSection
          value={systemPromptAppend ?? ''}
          onChange={onSystemPromptAppendChange}
        />
      )}
    </div>
  );
}

function CustomInstructionsSection({ value, onChange }: { value: string; onChange: (v: string | null) => void }) {
  const [localValue, setLocalValue] = useState(value);
  const [isExpanded, setIsExpanded] = useState(!!value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback((newValue: string) => {
    setLocalValue(newValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange(newValue.trim() || null);
    }, 800);
  }, [onChange]);

  return (
    <div className="p-4 space-y-2 border-t border-border">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors"
      >
        <span>Custom Instructions</span>
        <span className="text-xs text-muted-foreground">{isExpanded ? 'Hide' : 'Show'}</span>
      </button>
      {isExpanded && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Additional instructions appended to the system prompt for this session.
          </p>
          <textarea
            className="w-full min-h-[80px] max-h-[200px] resize-y rounded-md border border-border bg-background px-2.5 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
            placeholder="e.g. Always explain your reasoning step by step..."
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
          />
          {localValue && localValue !== value && (
            <p className="text-xs text-muted-foreground/70 italic">Saving...</p>
          )}
        </div>
      )}
    </div>
  );
}
