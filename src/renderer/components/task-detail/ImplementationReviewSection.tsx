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
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Implementation Review</h3>
      {reviewEntries.map((entry) => {
        const isApproved = entry.entryType === 'review_approved';
        const comments = Array.isArray(entry.data?.comments) ? (entry.data.comments as unknown[]) : null;
        return (
          <div
            key={entry.id}
            style={{
              border: `1px solid ${isApproved ? '#3fb950' : '#f0a450'}`,
              borderRadius: 6,
              padding: '10px 14px',
              marginBottom: 8,
              fontSize: 13,
              opacity: entry.addressed ? 0.5 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 12,
                  backgroundColor: isApproved ? 'rgba(63,185,80,0.15)' : 'rgba(240,164,80,0.15)',
                  color: isApproved ? '#3fb950' : '#f0a450',
                  border: `1px solid ${isApproved ? '#3fb950' : '#f0a450'}`,
                }}
              >
                {isApproved ? 'Approved' : 'Feedback'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{entry.source}</span>
              <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                {new Date(entry.createdAt).toLocaleString()}
              </span>
              {entry.addressed && (
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 4,
                    backgroundColor: 'var(--muted)',
                    color: 'var(--muted-foreground)',
                  }}
                >
                  Addressed
                </span>
              )}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', marginBottom: comments ? 8 : 0 }}>{entry.summary}</div>
            {comments && comments.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12, color: 'var(--muted-foreground)' }}>
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
