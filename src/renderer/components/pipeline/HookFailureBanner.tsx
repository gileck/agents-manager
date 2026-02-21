import React from 'react';
import { Button } from '../ui/button';
import type { HookFailureRecord } from '../../../shared/types';

interface HookFailureBannerProps {
  failures: HookFailureRecord[];
  retrying: string | null;
  onRetry: (hookName: string, transitionFrom: string, transitionTo: string) => void;
  onDismiss: (failureId: string) => void;
}

const POLICY_COLORS: Record<string, { bg: string; text: string }> = {
  required: { bg: '#fef2f2', text: '#dc2626' },
  best_effort: { bg: '#fffbeb', text: '#d97706' },
  fire_and_forget: { bg: '#f0f9ff', text: '#0284c7' },
};

export function HookFailureBanner({ failures, retrying, onRetry, onDismiss }: HookFailureBannerProps) {
  if (failures.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {failures.map((failure) => {
        const colors = POLICY_COLORS[failure.policy] ?? POLICY_COLORS.best_effort;
        return (
          <div
            key={failure.id}
            className="rounded-md px-4 py-3 flex items-start gap-3 text-sm"
            style={{ backgroundColor: colors.bg, border: `1px solid ${colors.text}33` }}
          >
            <span style={{ color: colors.text, marginTop: '2px', flexShrink: 0 }}>&#9888;</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium" style={{ color: colors.text }}>
                  Hook failed: {failure.hookName}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded text-xs font-mono"
                  style={{ backgroundColor: `${colors.text}15`, color: colors.text }}
                >
                  {failure.policy}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(failure.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs mt-1" style={{ color: colors.text }}>
                {failure.error}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {failure.retryable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={retrying === failure.hookName}
                  onClick={() => onRetry(failure.hookName, failure.transitionFrom, failure.transitionTo)}
                  style={{ borderColor: colors.text, color: colors.text }}
                >
                  {retrying === failure.hookName ? 'Retrying...' : 'Retry'}
                </Button>
              )}
              <button
                className="text-muted-foreground hover:opacity-80 text-lg leading-none"
                onClick={() => onDismiss(failure.id)}
              >
                &times;
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
