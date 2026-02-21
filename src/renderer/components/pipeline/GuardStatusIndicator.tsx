import React, { useState } from 'react';
import type { GuardCheckResult } from '../../../shared/types';

interface GuardStatusIndicatorProps {
  guardStatus?: GuardCheckResult;
}

export function GuardStatusIndicator({ guardStatus }: GuardStatusIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!guardStatus) return null;

  const color = guardStatus.canTransition ? '#22c55e' : '#ef4444';
  const failedGuards = guardStatus.results.filter((r) => !r.allowed);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        className="inline-block rounded-full"
        style={{ width: '8px', height: '8px', backgroundColor: color }}
      />
      {showTooltip && failedGuards.length > 0 && (
        <div
          className="absolute bottom-full left-1/2 mb-1 z-50 rounded-md shadow-lg px-3 py-2 text-xs"
          style={{
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--popover, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            minWidth: '200px',
            maxWidth: '300px',
          }}
        >
          {failedGuards.map((g, i) => (
            <div key={i} className="mb-1 last:mb-0">
              <span className="font-mono font-medium">{g.guard}</span>
              {g.reason && (
                <span className="text-muted-foreground"> — {g.reason}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
