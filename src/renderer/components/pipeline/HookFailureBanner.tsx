import React from 'react';
import { Button } from '../ui/button';
import type { HookFailureRecord } from '../../../shared/types';

interface HookFailureBannerProps {
  failures: HookFailureRecord[];
  retrying: string | null;
  onRetry: (hookName: string, transitionFrom: string, transitionTo: string) => void;
  onDismiss: (failureId: string) => void;
  onReportBug?: (failure: HookFailureRecord) => void;
}

const POLICY_COLORS: Record<string, { bg: string; border: string; text: string; badgeBg: string }> = {
  required:        { bg: '#2d1111', border: '#7f1d1d', text: '#f87171', badgeBg: '#3f1515' },
  best_effort:     { bg: '#2d1d00', border: '#78350f', text: '#fbbf24', badgeBg: '#3f2800' },
  fire_and_forget: { bg: '#0c1a2d', border: '#1e3a5f', text: '#60a5fa', badgeBg: '#0f2240' },
};

type GroupedFailure = {
  key: string;
  latest: HookFailureRecord;
  ids: string[];
  count: number;
};

function groupFailures(failures: HookFailureRecord[]): GroupedFailure[] {
  const map = new Map<string, GroupedFailure>();
  for (const f of failures) {
    const key = `${f.hookName}|${f.error}`;
    const existing = map.get(key);
    if (existing) {
      existing.ids.push(f.id);
      existing.count++;
      if (f.timestamp > existing.latest.timestamp) existing.latest = f;
    } else {
      map.set(key, { key, latest: f, ids: [f.id], count: 1 });
    }
  }
  return Array.from(map.values());
}

export function HookFailureBanner({ failures, retrying, onRetry, onDismiss, onReportBug }: HookFailureBannerProps) {
  if (failures.length === 0) return null;

  const groups = groupFailures(failures);

  return (
    <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {groups.map((group) => {
        const { latest, ids, count } = group;
        const resolvedColors = POLICY_COLORS[latest.policy];
        if (!resolvedColors) {
          console.warn(`HookFailureBanner: Unknown hook policy "${latest.policy}", falling back to best_effort styling`);
        }
        const colors = resolvedColors ?? POLICY_COLORS.best_effort;

        return (
          <div
            key={group.key}
            style={{
              borderRadius: 6,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 13,
              backgroundColor: colors.bg,
              border: `1px solid ${colors.border}`,
            }}
          >
            <span style={{ color: colors.text, marginTop: 1, flexShrink: 0 }}>⚠</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: colors.text }}>
                  Hook failed: {latest.hookName}
                </span>
                <span style={{
                  padding: '1px 6px', borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
                  backgroundColor: colors.badgeBg, color: colors.text, border: `1px solid ${colors.border}`,
                }}>
                  {latest.policy}
                </span>
                {count > 1 && (
                  <span style={{
                    padding: '1px 7px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                    backgroundColor: colors.border, color: '#fff',
                  }}>
                    ×{count}
                  </span>
                )}
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {new Date(latest.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p style={{ fontSize: 12, marginTop: 3, color: colors.text, opacity: 0.85 }}>
                {latest.error}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {latest.retryable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={retrying === latest.hookName}
                  onClick={() => onRetry(latest.hookName, latest.transitionFrom, latest.transitionTo)}
                  style={{ borderColor: colors.border, color: colors.text }}
                >
                  {retrying === latest.hookName ? 'Retrying...' : 'Retry'}
                </Button>
              )}
              {onReportBug && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReportBug(latest)}
                  style={{ borderColor: colors.border, color: colors.text }}
                >
                  Report Bug
                </Button>
              )}
              <button
                onClick={() => ids.forEach((id) => onDismiss(id))}
                style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
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
