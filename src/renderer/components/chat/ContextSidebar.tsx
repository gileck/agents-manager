import React from 'react';
import type { AgentChatMessage, AgentRun } from '../../../shared/types';
import { calculateCost } from '../../../shared/cost-utils';

interface ContextSidebarProps {
  messages: AgentChatMessage[];
  run?: AgentRun | null;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

const CONTEXT_WINDOW = 200_000;

export function ContextSidebar({ messages, run, tokenUsage }: ContextSidebarProps) {
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
  const estimatedCost = calculateCost(totalInput, totalOutput, run?.model ?? undefined);
  const contextUsagePercent = Math.min((totalInput / CONTEXT_WINDOW) * 100, 100);

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div className="p-4 space-y-4 border-b border-border">
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
        <div className="flex justify-between text-sm font-medium">
          <span>Total</span>
          <span className="font-mono">{formatNumber(totalTokens)}</span>
        </div>

        <hr className="border-border" />

        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Est. cost</span>
          <span className="font-mono">${estimatedCost.toFixed(4)}</span>
        </div>

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
            {formatNumber(totalInput)} / {formatNumber(CONTEXT_WINDOW)}
          </div>
        </div>
      </div>
    </div>
  );
}
