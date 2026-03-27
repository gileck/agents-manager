import React from 'react';
import type { TaskContextEntry, ReviewComment } from '../../../shared/types';
import { MarkdownContent } from '../chat/MarkdownContent';

const SEVERITY_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  must_fix: { bg: 'hsl(var(--destructive) / 0.08)', color: 'hsl(var(--destructive))', label: 'Must Fix' },
  should_fix: { bg: 'hsl(var(--warning) / 0.08)', color: 'hsl(var(--warning))', label: 'Should Fix' },
  nit: { bg: 'hsl(var(--muted) / 0.5)', color: 'var(--muted-foreground)', label: 'Nit' },
};

function isStructuredComment(c: unknown): c is ReviewComment {
  return typeof c === 'object' && c !== null && 'file' in c && 'severity' in c && 'issue' in c && 'suggestion' in c;
}

function StructuredCommentItem({ comment }: { comment: ReviewComment }) {
  const severity = SEVERITY_STYLES[comment.severity] ?? SEVERITY_STYLES.nit;
  return (
    <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid hsl(var(--border) / 0.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 3,
            backgroundColor: severity.bg,
            color: severity.color,
          }}
        >
          {severity.label}
        </span>
        <code style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{comment.file}</code>
      </div>
      <div style={{ fontSize: 12, color: 'var(--foreground)', lineHeight: 1.5 }}>
        <MarkdownContent content={comment.issue} />
      </div>
      {comment.suggestion && (
        <div style={{ fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.5, marginTop: 2 }}>
          <strong>Suggestion:</strong> <MarkdownContent content={comment.suggestion} />
        </div>
      )}
    </div>
  );
}

interface ImplementationReviewSectionProps {
  contextEntries: TaskContextEntry[] | null;
}

export function ImplementationReviewSection({ contextEntries }: ImplementationReviewSectionProps) {
  const allEntries = (contextEntries ?? [])
    .filter((e) => e.entryType === 'review_feedback' || e.entryType === 'review_approved' || e.entryType === 'fix_summary')
    .sort((a, b) => a.createdAt - b.createdAt);

  const hasReviewEntries = allEntries.some((e) => e.entryType === 'review_feedback' || e.entryType === 'review_approved');
  if (!hasReviewEntries) return null;

  return (
    <div style={{ marginTop: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Implementation Review
      </div>
      {allEntries.map((entry) => {
        if (entry.entryType === 'fix_summary') {
          return (
            <div
              key={entry.id}
              style={{
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 8,
                fontSize: 13,
                opacity: entry.addressed ? 0.5 : 1,
                border: '1px solid hsl(var(--border) / 0.7)',
                borderLeft: '3px solid hsl(var(--border) / 0.5)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 4,
                    backgroundColor: 'hsl(var(--muted) / 0.5)',
                    color: 'var(--muted-foreground)',
                  }}
                >
                  Revised Implementation
                </span>
                <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground) / 0.6)' }}>
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
                {entry.addressed && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 4,
                      backgroundColor: 'hsl(var(--muted))',
                      color: 'var(--muted-foreground)',
                      fontWeight: 500,
                    }}
                  >
                    Addressed
                  </span>
                )}
              </div>
              <div style={{ lineHeight: 1.5 }}>
                <MarkdownContent content={entry.summary} />
              </div>
            </div>
          );
        }

        const isApproved = entry.entryType === 'review_approved';
        const comments = Array.isArray(entry.data?.comments) ? (entry.data.comments as unknown[]) : null;
        return (
          <div
            key={entry.id}
            style={{
              borderRadius: 8,
              padding: '12px 14px',
              marginBottom: 8,
              fontSize: 13,
              opacity: entry.addressed ? 0.5 : 1,
              border: '1px solid hsl(var(--border) / 0.7)',
              borderLeft: `3px solid ${isApproved ? 'hsl(var(--success) / 0.5)' : 'hsl(var(--warning) / 0.5)'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 4,
                  backgroundColor: isApproved ? 'hsl(var(--success) / 0.08)' : 'hsl(var(--warning) / 0.08)',
                  color: isApproved ? 'hsl(var(--success))' : 'hsl(var(--warning))',
                }}
              >
                {isApproved ? 'Approved' : 'Feedback'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted-foreground)', fontWeight: 500 }}>{entry.source}</span>
              <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground) / 0.6)' }}>
                {new Date(entry.createdAt).toLocaleString()}
              </span>
              {entry.addressed && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 4,
                    backgroundColor: 'hsl(var(--muted))',
                    color: 'var(--muted-foreground)',
                    fontWeight: 500,
                  }}
                >
                  Addressed
                </span>
              )}
            </div>
            <div style={{ lineHeight: 1.5 }}>
              <MarkdownContent content={entry.summary} />
            </div>
            {comments && comments.length > 0 && (
              <div style={{
                marginTop: 8, paddingTop: 8,
                borderTop: '1px solid hsl(var(--border) / 0.4)',
              }}>
                {comments.map((c, i) =>
                  isStructuredComment(c) ? (
                    <StructuredCommentItem key={i} comment={c} />
                  ) : (
                    <div key={i} style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 4, lineHeight: 1.5 }}>
                      <MarkdownContent content={typeof c === 'string' ? c : JSON.stringify(c)} />
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
