import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import type { TaskArtifact, Transition, TaskContextEntry, ImplementationPhase } from '../../../shared/types';
import { ImplementationReviewSection } from '../task-detail/ImplementationReviewSection';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { reportError } from '../../lib/error-handler';

// ---------------------------------------------------------------------------
// Diff parsing helpers
// ---------------------------------------------------------------------------

interface DiffLine {
  type: 'context' | 'addition' | 'deletion' | 'hunk-header';
  content: string;
  oldLine?: number;
  newLine?: number;
}

interface FileDiff {
  filename: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } {
  const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return match
    ? { oldStart: parseInt(match[1], 10), newStart: parseInt(match[2], 10) }
    : { oldStart: 1, newStart: 1 };
}

function parseDiff(raw: string): FileDiff[] {
  if (!raw) return [];
  const files: FileDiff[] = [];
  const sections = raw.split(/^diff --git /m).filter(Boolean);
  for (const section of sections) {
    const rawLines = section.split('\n');
    const plusLine = rawLines.find((l) => l.startsWith('+++ b/'));
    const filename = plusLine ? plusLine.slice(6) : rawLines[0]?.split(' ')[0] ?? 'unknown';
    let additions = 0;
    let deletions = 0;
    const diffLines: DiffLine[] = [];
    let inHunk = false;
    let oldLine = 0;
    let newLine = 0;
    for (const line of rawLines) {
      if (line.startsWith('@@')) {
        inHunk = true;
        const { oldStart, newStart } = parseHunkHeader(line);
        oldLine = oldStart;
        newLine = newStart;
        diffLines.push({ type: 'hunk-header', content: line, oldLine: oldStart, newLine: newStart });
        continue;
      }
      if (!inHunk) continue;
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
        diffLines.push({ type: 'addition', content: line.slice(1), newLine: newLine });
        newLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
        diffLines.push({ type: 'deletion', content: line.slice(1), oldLine: oldLine });
        oldLine++;
      } else if (line.startsWith(' ') || line === '') {
        diffLines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : '', oldLine: oldLine, newLine: newLine });
        oldLine++;
        newLine++;
      } else if (line.startsWith('diff ') || line.startsWith('Binary') || line.startsWith('\\')) {
        break;
      }
    }
    files.push({ filename, additions, deletions, lines: diffLines });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const colors = {
  addBg: 'rgba(63, 185, 80, 0.15)',
  addBorder: 'rgba(63, 185, 80, 0.3)',
  addGutter: 'rgba(63, 185, 80, 0.25)',
  addText: '#3fb950',
  delBg: 'rgba(248, 81, 73, 0.15)',
  delBorder: 'rgba(248, 81, 73, 0.3)',
  delGutter: 'rgba(248, 81, 73, 0.25)',
  delText: '#f85149',
  hunkBg: 'rgba(56, 139, 253, 0.1)',
  hunkText: '#8b949e',
  vscodeBg: 'rgba(56, 139, 253, 0.1)',
  vscodeHover: 'rgba(56, 139, 253, 0.2)',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffSummaryBar({ files }: { files: FileDiff[] }) {
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 0', fontSize: 13, color: 'var(--muted-foreground)',
    }}>
      <span style={{ fontWeight: 500, color: 'var(--foreground)' }}>
        {files.length} file{files.length !== 1 ? 's' : ''} changed
      </span>
      {totalAdd > 0 && <span style={{ color: colors.addText, fontWeight: 500 }}>+{totalAdd}</span>}
      {totalDel > 0 && <span style={{ color: colors.delText, fontWeight: 500 }}>-{totalDel}</span>}
      <DiffBar additions={totalAdd} deletions={totalDel} />
    </div>
  );
}

function DiffBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const blocks = 5;
  const addBlocks = Math.round((additions / total) * blocks);
  const delBlocks = blocks - addBlocks;
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {Array.from({ length: addBlocks }).map((_, i) => (
        <span key={`a${i}`} style={{ width: 8, height: 8, borderRadius: 1, background: colors.addText }} />
      ))}
      {Array.from({ length: delBlocks }).map((_, i) => (
        <span key={`d${i}`} style={{ width: 8, height: 8, borderRadius: 1, background: colors.delText }} />
      ))}
    </span>
  );
}

function FileNav({ files, onJump }: { files: FileDiff[]; onJump: (idx: number) => void }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6,
      marginBottom: 16, overflow: 'hidden',
    }}>
      {files.map((f, i) => (
        <button
          key={i}
          onClick={() => onJump(i)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '6px 12px', border: 'none', background: 'transparent',
            cursor: 'pointer', fontSize: 13, textAlign: 'left',
            borderBottom: i < files.length - 1 ? '1px solid var(--border)' : 'none',
          }}
          className="hover:bg-muted/50"
        >
          <span style={{ fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--foreground)' }}>
            {f.filename}
          </span>
          <span style={{ display: 'flex', gap: 6, fontSize: 12, flexShrink: 0 }}>
            {f.additions > 0 && <span style={{ color: colors.addText }}>+{f.additions}</span>}
            {f.deletions > 0 && <span style={{ color: colors.delText }}>-{f.deletions}</span>}
          </span>
          <DiffBar additions={f.additions} deletions={f.deletions} />
        </button>
      ))}
    </div>
  );
}

function VscodeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M11.5 1L5.5 7L2.5 4.5L1 5.5L5.5 9.5L13 2.5L11.5 1Z" fill="currentColor" opacity="0.8" />
      <path d="M1 5.5V11.5L2.5 12.5L5.5 10L11.5 16L13 14.5V2.5L11.5 1L5.5 7L2.5 4.5L1 5.5Z" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function FileDiffCard({
  file,
  fileRef,
  projectPath,
  defaultExpanded,
}: {
  file: FileDiff;
  fileRef: React.RefObject<HTMLDivElement | null>;
  projectPath: string | null;
  defaultExpanded: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);

  const openInVscode = useCallback((line?: number) => {
    if (!projectPath) return;
    const filePath = `${projectPath}/${file.filename}`;
    window.api.shell.openFileInVscode(filePath, line).catch((err) =>
      reportError(err, `Open ${file.filename} in VS Code`),
    );
  }, [projectPath, file.filename]);

  return (
    <div ref={fileRef} style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      {/* File header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', background: 'var(--muted)',
          position: 'sticky', top: 0, zIndex: 2,
          borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        <button
          onClick={() => setOpen(!open)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'var(--muted-foreground)', fontSize: 10 }}
        >
          {open ? '▼' : '▶'}
        </button>
        <button
          onClick={() => openInVscode()}
          style={{
            fontFamily: 'monospace', fontSize: 13, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: 'pointer',
            textAlign: 'left', color: 'var(--foreground)', padding: 0,
          }}
          title={projectPath ? `Open ${file.filename} in VS Code` : file.filename}
          className="hover:underline"
        >
          {file.filename}
        </button>
        <span style={{ display: 'flex', gap: 6, fontSize: 12, flexShrink: 0 }}>
          {file.additions > 0 && <span style={{ color: colors.addText, fontWeight: 500 }}>+{file.additions}</span>}
          {file.deletions > 0 && <span style={{ color: colors.delText, fontWeight: 500 }}>-{file.deletions}</span>}
        </span>
        {projectPath && (
          <button
            onClick={() => openInVscode()}
            style={{
              background: colors.vscodeBg, border: 'none', borderRadius: 4,
              padding: '2px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, color: '#58a6ff', flexShrink: 0,
            }}
            title="Open in VS Code"
            className="hover:opacity-80"
          >
            <VscodeIcon size={12} />
          </button>
        )}
      </div>

      {/* Diff body */}
      {open && (
        <div style={{ overflow: 'auto', maxHeight: 600, fontSize: 12, fontFamily: 'monospace', lineHeight: '20px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {file.lines.map((line, i) => {
                if (line.type === 'hunk-header') {
                  return (
                    <tr key={i}>
                      <td colSpan={3} style={{
                        padding: '4px 12px', background: colors.hunkBg,
                        color: colors.hunkText, fontSize: 12,
                        borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                        borderBottom: '1px solid var(--border)',
                      }}>
                        {line.content}
                      </td>
                    </tr>
                  );
                }

                const isAdd = line.type === 'addition';
                const isDel = line.type === 'deletion';
                const bg = isAdd ? colors.addBg : isDel ? colors.delBg : 'transparent';
                const gutterBg = isAdd ? colors.addGutter : isDel ? colors.delGutter : 'transparent';
                const lineNum = isAdd ? line.newLine : isDel ? line.oldLine : line.oldLine;
                const canOpenVscode = projectPath && lineNum;

                return (
                  <tr
                    key={i}
                    style={{ background: bg }}
                    className="diff-line-row"
                  >
                    {/* Old line number */}
                    <td style={{
                      width: 40, minWidth: 40, textAlign: 'right',
                      padding: '0 6px', color: 'var(--muted-foreground)',
                      background: gutterBg, userSelect: 'none',
                      fontSize: 11, verticalAlign: 'top', lineHeight: '20px',
                      cursor: canOpenVscode ? 'pointer' : 'default',
                      borderRight: '1px solid var(--border)',
                    }}
                    onClick={canOpenVscode ? () => openInVscode(line.oldLine ?? line.newLine) : undefined}
                    title={canOpenVscode ? `Open line ${line.oldLine ?? line.newLine} in VS Code` : undefined}
                    >
                      {isDel ? line.oldLine : line.type === 'context' ? line.oldLine : ''}
                    </td>
                    {/* New line number */}
                    <td style={{
                      width: 40, minWidth: 40, textAlign: 'right',
                      padding: '0 6px', color: 'var(--muted-foreground)',
                      background: gutterBg, userSelect: 'none',
                      fontSize: 11, verticalAlign: 'top', lineHeight: '20px',
                      cursor: canOpenVscode ? 'pointer' : 'default',
                      borderRight: '1px solid var(--border)',
                    }}
                    onClick={canOpenVscode ? () => openInVscode(line.newLine ?? line.oldLine) : undefined}
                    title={canOpenVscode ? `Open line ${line.newLine ?? line.oldLine} in VS Code` : undefined}
                    >
                      {isAdd ? line.newLine : line.type === 'context' ? line.newLine : ''}
                    </td>
                    {/* Content */}
                    <td style={{
                      padding: '0 12px', whiteSpace: 'pre',
                      overflow: 'visible',
                      color: isAdd ? colors.addText : isDel ? colors.delText : 'var(--foreground)',
                    }}>
                      <span style={{ userSelect: 'none', marginRight: 4, opacity: 0.6 }}>
                        {isAdd ? '+' : isDel ? '-' : ' '}
                      </span>
                      {line.content || '\u00A0'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PR Header
// ---------------------------------------------------------------------------

function PrHeader({ prLink, branchName }: { prLink?: string | null; branchName?: string | null }) {
  if (!prLink) return null;
  // Extract PR number from URL
  const prMatch = prLink.match(/\/pull\/(\d+)/);
  const prNumber = prMatch ? `#${prMatch[1]}` : '';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', marginBottom: 16,
      border: '1px solid var(--border)', borderRadius: 8,
      background: 'var(--card)',
    }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ color: '#8b949e', flexShrink: 0 }}>
        <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          onClick={() => window.api.shell.openInChrome(prLink).catch((err) => reportError(err, 'Open PR in browser'))}
          style={{
            fontSize: 13, color: '#58a6ff', cursor: 'pointer',
            background: 'none', border: 'none', textAlign: 'left',
            fontWeight: 500, padding: 0,
          }}
          className="hover:underline"
        >
          Pull Request {prNumber}
        </button>
        {branchName && (
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
            <code style={{
              padding: '1px 6px', borderRadius: 4,
              background: 'rgba(56, 139, 253, 0.1)', fontSize: 11,
            }}>
              {branchName}
            </code>
          </div>
        )}
      </div>
      <button
        onClick={() => window.api.shell.openInChrome(prLink).catch((err) => reportError(err, 'Open PR in browser'))}
        style={{
          fontSize: 11, padding: '4px 10px', borderRadius: 6,
          background: 'rgba(56, 139, 253, 0.1)', border: '1px solid rgba(56, 139, 253, 0.3)',
          color: '#58a6ff', cursor: 'pointer', flexShrink: 0, fontWeight: 500,
        }}
        className="hover:opacity-80"
      >
        View on GitHub
      </button>
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
  phases,
}: {
  taskId: string;
  task: { status: string; prLink?: string | null; branchName?: string | null };
  artifacts: TaskArtifact[] | null;
  transitions: Transition[];
  transitioning: string | null;
  contextEntries: TaskContextEntry[] | null;
  onTransition: (toStatus: string) => void;
  onContextAdded: () => void;
  phases?: ImplementationPhase[] | null;
}) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { currentProject } = useCurrentProject();
  const projectPath = currentProject?.path ?? null;

  // Parse diffs from all diff artifacts
  const fileDiffs = useMemo(() => {
    const diffArtifacts = artifacts?.filter((a) => a.type === 'diff') ?? [];
    const allDiffs: FileDiff[] = [];
    for (const artifact of diffArtifacts) {
      const raw = (artifact.data as { diff?: string } | undefined)?.diff ?? '';
      allDiffs.push(...parseDiff(raw));
    }
    return allDiffs;
  }, [artifacts]);

  // Refs for scrolling to files
  const fileRefs = useMemo(
    () => fileDiffs.map(() => React.createRef<HTMLDivElement>()),
    [fileDiffs],
  );

  const jumpToFile = useCallback((idx: number) => {
    fileRefs[idx]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [fileRefs]);

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
      reportError(err instanceof Error ? err : new Error(String(err)), 'Submit change request');
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

  const canRequestChanges = transitions.some((t) => t.to === 'implementing');
  const mergeTransition = transitions.find((t) => t.label?.toLowerCase().includes('merge') && !t.label?.toLowerCase().includes('failed'));
  const approveTransition = transitions.find((t) => t.label?.toLowerCase().includes('approve'));

  const isMultiPhase = phases && phases.length > 1;
  const activePhaseIdx = phases?.findIndex(p => p.status === 'in_progress') ?? -1;
  const completedPhases = phases?.filter(p => p.status === 'completed' && p.prLink) ?? [];

  const hasChanges = fileDiffs.length > 0;
  const hasContent = hasChanges || task.prLink;

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto' }}>
      {/* Phase indicator for multi-phase tasks */}
      {isMultiPhase && activePhaseIdx >= 0 && (
        <div style={{
          marginBottom: 16, padding: '8px 12px', borderRadius: 6,
          backgroundColor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
          fontSize: 13,
        }}>
          <span style={{ fontWeight: 600 }}>Phase {activePhaseIdx + 1}/{phases!.length}</span>
          <span style={{ color: 'var(--muted-foreground)', marginLeft: 8 }}>{phases![activePhaseIdx].name}</span>
        </div>
      )}

      {/* Completed phase PRs */}
      {completedPhases.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Merged PRs</h4>
          {completedPhases.map((p) => {
            const phaseNum = phases!.indexOf(p) + 1;
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#16a34a' }}>✓</span>
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Phase {phaseNum}:</span>
                <button
                  onClick={() => window.api.shell.openInChrome(p.prLink!).catch((err) => reportError(err, 'Open PR in browser'))}
                  style={{ fontSize: 12, color: '#58a6ff', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
                  className="hover:underline"
                >
                  {p.prLink}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* PR Header */}
      <PrHeader
        prLink={task.prLink}
        branchName={task.branchName}
      />

      {/* Diff section */}
      {hasChanges && (
        <>
          {/* Summary bar */}
          <DiffSummaryBar files={fileDiffs} />

          {/* File navigation */}
          <FileNav files={fileDiffs} onJump={jumpToFile} />

          {/* File diffs */}
          {fileDiffs.map((f, i) => (
            <FileDiffCard
              key={`${f.filename}-${i}`}
              file={f}
              fileRef={fileRefs[i]}
              projectPath={projectPath}
              defaultExpanded={fileDiffs.length <= 8}
            />
          ))}
        </>
      )}

      {!hasContent && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
          No implementation data yet. Diffs and PR link will appear after the implementor agent completes.
        </div>
      )}

      {/* Implementation review output from reviewer agent */}
      <ImplementationReviewSection contextEntries={contextEntries} />

      {/* Previous change request comments */}
      {changeRequests.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Change Requests
          </h4>
          {changeRequests.map((entry) => (
            <div
              key={entry.id}
              style={{
                border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px',
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
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Feedback
          </h4>
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
