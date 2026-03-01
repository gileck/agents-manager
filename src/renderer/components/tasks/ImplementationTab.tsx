import React, { useState, useMemo } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import type { TaskArtifact, Transition, TaskContextEntry } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Diff parsing helpers
// ---------------------------------------------------------------------------

interface FileDiff {
  filename: string;
  additions: number;
  deletions: number;
  lines: string[];
}

function parseDiff(raw: string): FileDiff[] {
  if (!raw) return [];
  const files: FileDiff[] = [];
  const sections = raw.split(/^diff --git /m).filter(Boolean);
  for (const section of sections) {
    const lines = section.split('\n');
    // Extract filename from +++ b/path
    const plusLine = lines.find((l) => l.startsWith('+++ b/'));
    const filename = plusLine ? plusLine.slice(6) : lines[0]?.split(' ')[0] ?? 'unknown';
    let additions = 0;
    let deletions = 0;
    const diffLines: string[] = [];
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith('@@')) {
        inHunk = true;
        diffLines.push(line);
      } else if (inHunk) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++;
          diffLines.push(line);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
          diffLines.push(line);
        } else if (line.startsWith(' ') || line === '') {
          diffLines.push(line);
        } else if (line.startsWith('diff ') || line.startsWith('Binary')) {
          break;
        } else {
          diffLines.push(line);
        }
      }
    }
    files.push({ filename, additions, deletions, lines: diffLines });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FileDiffCard({ file }: { file: FileDiff }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', background: 'var(--muted)', border: 'none', cursor: 'pointer',
          fontSize: 13, textAlign: 'left',
        }}
      >
        <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>{open ? '▼' : '▶'}</span>
        <span style={{ fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.filename}
        </span>
        {file.additions > 0 && <span style={{ color: '#3fb950', fontSize: 12 }}>+{file.additions}</span>}
        {file.deletions > 0 && <span style={{ color: '#f85149', fontSize: 12 }}>-{file.deletions}</span>}
      </button>
      {open && (
        <pre style={{
          margin: 0, padding: '8px 12px', fontSize: 12, fontFamily: 'monospace',
          overflow: 'auto', maxHeight: 500, lineHeight: 1.5, background: 'var(--card)',
        }}>
          {file.lines.map((line, i) => {
            let color = 'var(--foreground)';
            let bg = 'transparent';
            if (line.startsWith('+')) { color = '#3fb950'; bg = 'rgba(63,185,80,0.1)'; }
            else if (line.startsWith('-')) { color = '#f85149'; bg = 'rgba(248,81,73,0.1)'; }
            else if (line.startsWith('@@')) { color = '#8b949e'; }
            return (
              <div key={i} style={{ color, backgroundColor: bg, padding: '0 4px' }}>
                {line || '\u00A0'}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ImplementationTab({
  taskId,
  task,
  artifacts,
  transitions,
  transitioning,
  contextEntries,
  onTransition,
  onContextAdded,
}: {
  taskId: string;
  task: { status: string; prLink?: string | null };
  artifacts: TaskArtifact[] | null;
  transitions: Transition[];
  transitioning: string | null;
  contextEntries: TaskContextEntry[] | null;
  onTransition: (toStatus: string) => void;
  onContextAdded: () => void;
}) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Parse diff from artifacts
  const diffArtifact = artifacts?.find((a) => a.type === 'diff');
  const diffRaw = (diffArtifact?.data as { diff?: string } | undefined)?.diff ?? '';
  const fileDiffs = useMemo(() => parseDiff(diffRaw), [diffRaw]);

  // Filter existing change request comments
  const changeRequests = useMemo(
    () => (contextEntries ?? []).filter((e) => e.entryType === 'change_request'),
    [contextEntries],
  );

  const handleRequestChanges = async () => {
    if (!comment.trim()) return;
    setSubmitting(true);
    try {
      await window.api.tasks.addContextEntry(taskId, {
        source: 'user',
        entryType: 'change_request',
        summary: comment.trim(),
      });
      onContextAdded();
    } catch (err) {
      console.error('Failed to submit change request:', err);
      setSubmitting(false);
      return;
    }
    setComment('');
    try {
      onTransition('implementing');
    } finally {
      setSubmitting(false);
    }
  };

  // Check if a back-to-implementing transition is available (covers both "Request Changes" and legacy "Resolve Conflicts")
  const canRequestChanges = transitions.some((t) => t.to === 'implementing');
  // Check if merge/approve transitions are available
  const mergeTransition = transitions.find((t) => t.label?.toLowerCase().includes('merge'));
  const approveTransition = transitions.find((t) => t.label?.toLowerCase().includes('approve'));

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto' }}>
      {/* PR Link */}
      {task.prLink && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Pull Request</h3>
          <button
            onClick={() => window.api.shell.openInChrome(task.prLink!)}
            style={{ fontSize: 13, color: '#58a6ff', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
            className="hover:underline"
          >
            {task.prLink}
          </button>
        </div>
      )}

      {/* File Diffs */}
      {fileDiffs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            Changes ({fileDiffs.length} file{fileDiffs.length !== 1 ? 's' : ''})
          </h3>
          {fileDiffs.map((f, i) => (
            <FileDiffCard key={i} file={f} />
          ))}
        </div>
      )}

      {fileDiffs.length === 0 && !task.prLink && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
          No implementation data yet. Diffs and PR link will appear after the implementor agent completes.
        </div>
      )}

      {/* Previous change request comments */}
      {changeRequests.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Change Requests</h3>
          {changeRequests.map((entry) => (
            <div
              key={entry.id}
              style={{
                border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px',
                marginBottom: 8, fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: 'var(--muted-foreground)' }}>
                <span>{entry.source}</span>
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{entry.summary}</div>
            </div>
          ))}
        </div>
      )}

      {/* Comment input + actions */}
      {(canRequestChanges || mergeTransition || approveTransition) && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Feedback</h3>
          <Textarea
            placeholder="Describe the changes needed..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            style={{ marginBottom: 10, fontFamily: 'monospace', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canRequestChanges && (
              <Button
                variant="destructive"
                onClick={handleRequestChanges}
                disabled={!comment.trim() || submitting || transitioning !== null}
              >
                {submitting ? 'Submitting...' : 'Request Changes'}
              </Button>
            )}
            {approveTransition && (
              <Button
                variant="outline"
                onClick={() => onTransition(approveTransition.to)}
                disabled={transitioning !== null}
              >
                {transitioning === approveTransition.to ? 'Approving...' : (approveTransition.label ?? 'Approve')}
              </Button>
            )}
            {mergeTransition && (
              <Button
                onClick={() => onTransition(mergeTransition.to)}
                disabled={transitioning !== null}
              >
                {transitioning === mergeTransition.to ? 'Merging...' : (mergeTransition.label ?? 'Merge')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
