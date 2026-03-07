import React from 'react';
import type { TaskContextEntry } from '../../../shared/types';

interface ImplementationReviewSectionProps {
  contextEntries: TaskContextEntry[] | null;
}

export function ImplementationReviewSection({ contextEntries }: ImplementationReviewSectionProps) {
  const reviewEntries = (contextEntries ?? [])
    .filter((e) => e.entryType === 'review_feedback' || e.entryType === 'review_approved')
    .sort((a, b) => a.createdAt - b.createdAt);

  if (reviewEntries.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        Implementation Review
      </div>
      {reviewEntries.map((entry) => {
        const isApproved = entry.entryType === 'review_approved';
        const comments = Array.isArray(entry.data?.comments) ? (entry.data.comments as unknown[]) : null;
        return (
          <div
            key={entry.id}
            style={{
              borderRadius: 10,
              padding: '12px 16px',
              marginBottom: 8,
              fontSize: 13,
              opacity: entry.addressed ? 0.55 : 1,
              background: 'hsl(var(--card))',
              boxShadow: `0 0 0 1px ${isApproved ? 'hsl(var(--success) / 0.3)' : 'hsl(var(--warning) / 0.3)'}, 0 1px 3px hsl(var(--foreground) / 0.04)`,
              borderLeft: `3px solid ${isApproved ? 'hsl(var(--success) / 0.6)' : 'hsl(var(--warning) / 0.6)'}`,
              transition: 'opacity var(--motion-base) var(--ease-standard)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 10px',
                  borderRadius: 5,
                  backgroundColor: isApproved ? 'hsl(var(--success) / 0.1)' : 'hsl(var(--warning) / 0.1)',
                  color: isApproved ? 'hsl(var(--success))' : 'hsl(var(--warning))',
                }}
              >
                {isApproved ? 'Approved' : 'Feedback'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontWeight: 500 }}>{entry.source}</span>
              <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground) / 0.7)' }}>
                {new Date(entry.createdAt).toLocaleString()}
              </span>
              {entry.addressed && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 5,
                    backgroundColor: 'hsl(var(--muted))',
                    color: 'var(--muted-foreground)',
                    fontWeight: 500,
                  }}
                >
                  Addressed
                </span>
              )}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginBottom: comments ? 8 : 0, lineHeight: 1.55 }}>{entry.summary}</div>
            {comments && comments.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                {comments.map((c, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {typeof c === 'string' ? c : JSON.stringify(c)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
