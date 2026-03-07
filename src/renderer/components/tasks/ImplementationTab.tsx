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
// Helpers
// ---------------------------------------------------------------------------

/** Splits "src/core/services/chat-agent-service.ts" into ["src/core/services/", "chat-agent-service.ts"] */
function splitPath(filepath: string): { dir: string; base: string } {
  const idx = filepath.lastIndexOf('/');
  return idx < 0
    ? { dir: '', base: filepath }
    : { dir: filepath.slice(0, idx + 1), base: filepath.slice(idx + 1) };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffProgressBar({ additions, deletions, width = 48 }: { additions: number; deletions: number; width?: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const addWidth = Math.round((additions / total) * width);
  return (
    <span style={{ display: 'inline-flex', height: 6, width, borderRadius: 3, overflow: 'hidden', flexShrink: 0, opacity: 0.85 }}>
      <span style={{ width: addWidth, background: 'hsl(var(--success))' }} />
      <span style={{ width: width - addWidth, background: 'hsl(var(--destructive))' }} />
    </span>
  );
}

function DiffSummaryBar({ files }: { files: FileDiff[] }) {
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', fontSize: 12, color: 'var(--muted-foreground)',
      background: 'hsl(var(--surface-2) / 0.5)', borderRadius: 8,
      marginBottom: 12,
    }}>
      <span style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: 13 }}>
        {files.length} file{files.length !== 1 ? 's' : ''} changed
      </span>
      <span style={{ width: 1, height: 14, background: 'var(--border)', flexShrink: 0 }} />
      {totalAdd > 0 && <span style={{ color: 'hsl(var(--success))', fontWeight: 600, fontSize: 12 }}>+{totalAdd}</span>}
      {totalDel > 0 && <span style={{ color: 'hsl(var(--destructive))', fontWeight: 600, fontSize: 12 }}>-{totalDel}</span>}
      <DiffProgressBar additions={totalAdd} deletions={totalDel} width={56} />
    </div>
  );
}

function FileNav({ files, onJump }: { files: FileDiff[]; onJump: (idx: number) => void }) {
  return (
    <div style={{
      borderRadius: 10,
      marginBottom: 16, overflow: 'hidden',
      background: 'hsl(var(--card))',
      boxShadow: '0 1px 3px hsl(var(--foreground) / 0.04), 0 0 0 1px hsl(var(--border))',
    }}>
      {files.map((f, i) => {
        const { dir, base } = splitPath(f.filename);
        return (
          <button
            key={i}
            onClick={() => onJump(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '7px 14px', border: 'none', background: 'transparent',
              cursor: 'pointer', fontSize: 12, textAlign: 'left',
              borderBottom: i < files.length - 1 ? '1px solid hsl(var(--border) / 0.6)' : 'none',
              transition: 'background var(--motion-fast) var(--ease-standard)',
            }}
            className="hover:bg-accent/50"
          >
            <span style={{ color: 'hsl(var(--muted-foreground) / 0.6)', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>
              &#x1F4C4;
            </span>
            <span style={{ fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--muted-foreground)' }}>{dir}</span>
              <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{base}</span>
            </span>
            <span style={{ display: 'flex', gap: 6, fontSize: 11, flexShrink: 0, fontFamily: 'monospace' }}>
              {f.additions > 0 && <span style={{ color: 'hsl(var(--success))', fontWeight: 600 }}>+{f.additions}</span>}
              {f.deletions > 0 && <span style={{ color: 'hsl(var(--destructive))', fontWeight: 600 }}>-{f.deletions}</span>}
            </span>
            <DiffProgressBar additions={f.additions} deletions={f.deletions} width={40} />
          </button>
        );
      })}
    </div>
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
  const { dir, base } = splitPath(file.filename);

  const openInVscode = useCallback((line?: number) => {
    if (!projectPath) return;
    const filePath = `${projectPath}/${file.filename}`;
    window.api.shell.openFileInVscode(filePath, line).catch((err) =>
      reportError(err, `Open ${file.filename} in VS Code`),
    );
  }, [projectPath, file.filename]);

  return (
    <div
      ref={fileRef}
      style={{
        borderRadius: 10, marginBottom: 10, overflow: 'hidden',
        background: 'hsl(var(--card))',
        boxShadow: '0 1px 3px hsl(var(--foreground) / 0.04), 0 0 0 1px hsl(var(--border))',
      }}
    >
      {/* File header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          background: 'hsl(var(--surface-2) / 0.6)',
          position: 'sticky', top: 0, zIndex: 2,
          borderBottom: open ? '1px solid hsl(var(--border) / 0.6)' : 'none',
          backdropFilter: 'blur(8px)',
        }}
      >
        <button
          onClick={() => setOpen(!open)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
            display: 'flex', alignItems: 'center', color: 'var(--muted-foreground)',
            fontSize: 9, transition: 'transform var(--motion-fast) var(--ease-standard)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        >
          ▼
        </button>
        <button
          onClick={() => openInVscode()}
          style={{
            fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace", fontSize: 12.5, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: projectPath ? 'pointer' : 'default',
            textAlign: 'left', padding: 0,
          }}
          title={projectPath ? `Open ${file.filename} in VS Code` : file.filename}
          className={projectPath ? 'hover:underline' : ''}
        >
          <span style={{ color: 'var(--muted-foreground)' }}>{dir}</span>
          <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{base}</span>
        </button>
        <span style={{ display: 'flex', gap: 6, fontSize: 11, flexShrink: 0, fontFamily: 'monospace' }}>
          {file.additions > 0 && <span style={{ color: 'hsl(var(--success))', fontWeight: 600 }}>+{file.additions}</span>}
          {file.deletions > 0 && <span style={{ color: 'hsl(var(--destructive))', fontWeight: 600 }}>-{file.deletions}</span>}
        </span>
        {projectPath && (
          <button
            onClick={() => openInVscode()}
            style={{
              background: 'hsl(var(--primary) / 0.08)', border: 'none', borderRadius: 5,
              padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 10, color: 'hsl(var(--primary))', flexShrink: 0, fontWeight: 500,
              transition: 'background var(--motion-fast) var(--ease-standard)',
              letterSpacing: '0.3px',
            }}
            title="Open in VS Code"
            className="hover:bg-primary/15"
          >
            VS Code
          </button>
        )}
      </div>

      {/* Diff body */}
      {open && (
        <div style={{
          overflow: 'auto', maxHeight: 600,
          fontSize: 12, fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace", lineHeight: '20px',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', borderSpacing: 0 }}>
            <tbody>
              {file.lines.map((line, i) => {
                if (line.type === 'hunk-header') {
                  return (
                    <tr key={i}>
                      <td colSpan={3} style={{
                        padding: '6px 14px',
                        background: 'hsl(var(--primary) / 0.04)',
                        color: 'var(--muted-foreground)', fontSize: 11.5,
                        borderTop: i > 0 ? '1px solid hsl(var(--border) / 0.5)' : 'none',
                        borderBottom: '1px solid hsl(var(--border) / 0.5)',
                      }}>
                        {line.content}
                      </td>
                    </tr>
                  );
                }

                const isAdd = line.type === 'addition';
                const isDel = line.type === 'deletion';
                const bg = isAdd
                  ? 'hsl(var(--success) / 0.06)'
                  : isDel
                    ? 'hsl(var(--destructive) / 0.06)'
                    : 'transparent';
                const gutterBg = isAdd
                  ? 'hsl(var(--success) / 0.10)'
                  : isDel
                    ? 'hsl(var(--destructive) / 0.10)'
                    : 'transparent';
                const canOpenVscode = projectPath && (line.oldLine || line.newLine);

                return (
                  <tr key={i} style={{ background: bg }} className="diff-line-row">
                    {/* Old line number */}
                    <td
                      style={{
                        width: 44, minWidth: 44, textAlign: 'right',
                        padding: '0 8px', color: 'hsl(var(--muted-foreground) / 0.65)',
                        background: gutterBg, userSelect: 'none',
                        fontSize: 11, verticalAlign: 'top', lineHeight: '20px',
                        cursor: canOpenVscode ? 'pointer' : 'default',
                        borderRight: '1px solid hsl(var(--border) / 0.4)',
                      }}
                      onClick={canOpenVscode ? () => openInVscode(line.oldLine ?? line.newLine) : undefined}
                      title={canOpenVscode ? `Open line ${line.oldLine ?? line.newLine} in VS Code` : undefined}
                    >
                      {isDel ? line.oldLine : line.type === 'context' ? line.oldLine : ''}
                    </td>
                    {/* New line number */}
                    <td
                      style={{
                        width: 44, minWidth: 44, textAlign: 'right',
                        padding: '0 8px', color: 'hsl(var(--muted-foreground) / 0.65)',
                        background: gutterBg, userSelect: 'none',
                        fontSize: 11, verticalAlign: 'top', lineHeight: '20px',
                        cursor: canOpenVscode ? 'pointer' : 'default',
                        borderRight: '1px solid hsl(var(--border) / 0.4)',
                      }}
                      onClick={canOpenVscode ? () => openInVscode(line.newLine ?? line.oldLine) : undefined}
                      title={canOpenVscode ? `Open line ${line.newLine ?? line.oldLine} in VS Code` : undefined}
                    >
                      {isAdd ? line.newLine : line.type === 'context' ? line.newLine : ''}
                    </td>
                    {/* Content */}
                    <td style={{
                      padding: '0 14px', whiteSpace: 'pre', overflow: 'visible',
                      color: isAdd
                        ? 'hsl(var(--success) / 0.9)'
                        : isDel
                          ? 'hsl(var(--destructive) / 0.9)'
                          : 'var(--foreground)',
                    }}>
                      <span style={{ userSelect: 'none', display: 'inline-block', width: 14, opacity: 0.5, textAlign: 'center' }}>
                        {isAdd ? '+' : isDel ? '\u2212' : ' '}
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
  const prMatch = prLink.match(/\/pull\/(\d+)/);
  const prNumber = prMatch ? `#${prMatch[1]}` : '';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 16px', marginBottom: 14,
      borderRadius: 10,
      background: 'hsl(var(--card))',
      boxShadow: '0 1px 3px hsl(var(--foreground) / 0.04), 0 0 0 1px hsl(var(--border))',
    }}>
      {/* PR icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'hsl(var(--success) / 0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'hsl(var(--success))' }}>
          <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          onClick={() => window.api.shell.openInChrome(prLink).catch((err) => reportError(err, 'Open PR in browser'))}
          style={{
            fontSize: 14, color: 'hsl(var(--primary))', cursor: 'pointer',
            background: 'none', border: 'none', textAlign: 'left',
            fontWeight: 600, padding: 0,
          }}
          className="hover:underline"
        >
          Pull Request {prNumber}
        </button>
        {branchName && (
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 3 }}>
            <code style={{
              padding: '2px 8px', borderRadius: 5,
              background: 'hsl(var(--primary) / 0.06)',
              color: 'hsl(var(--primary) / 0.75)',
              fontSize: 11, fontWeight: 500,
              fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
            }}>
              {branchName}
            </code>
          </div>
        )}
      </div>
      <button
        onClick={() => window.api.shell.openInChrome(prLink).catch((err) => reportError(err, 'Open PR in browser'))}
        style={{
          fontSize: 12, padding: '6px 14px', borderRadius: 7,
          background: 'hsl(var(--primary) / 0.08)', border: '1px solid hsl(var(--primary) / 0.15)',
          color: 'hsl(var(--primary))', cursor: 'pointer', flexShrink: 0, fontWeight: 500,
          transition: 'all var(--motion-fast) var(--ease-standard)',
        }}
        className="hover:bg-primary/15"
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

  const fileDiffs = useMemo(() => {
    const diffArtifacts = artifacts?.filter((a) => a.type === 'diff') ?? [];
    const allDiffs: FileDiff[] = [];
    for (const artifact of diffArtifacts) {
      const raw = (artifact.data as { diff?: string } | undefined)?.diff ?? '';
      allDiffs.push(...parseDiff(raw));
    }
    return allDiffs;
  }, [artifacts]);

  const fileRefs = useMemo(
    () => fileDiffs.map(() => React.createRef<HTMLDivElement>()),
    [fileDiffs],
  );

  const jumpToFile = useCallback((idx: number) => {
    fileRefs[idx]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [fileRefs]);

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
    <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
      {/* Phase indicator for multi-phase tasks */}
      {isMultiPhase && activePhaseIdx >= 0 && (
        <div style={{
          marginBottom: 14, padding: '8px 14px', borderRadius: 8,
          background: 'hsl(var(--primary) / 0.06)', border: '1px solid hsl(var(--primary) / 0.12)',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            fontWeight: 600, fontSize: 11, padding: '2px 8px', borderRadius: 5,
            background: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))',
          }}>
            Phase {activePhaseIdx + 1}/{phases!.length}
          </span>
          <span style={{ color: 'var(--muted-foreground)' }}>{phases![activePhaseIdx].name}</span>
        </div>
      )}

      {/* Completed phase PRs */}
      {completedPhases.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Merged PRs
          </div>
          {completedPhases.map((p) => {
            const phaseNum = phases!.indexOf(p) + 1;
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'hsl(var(--success))' }}>&#x2713;</span>
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Phase {phaseNum}:</span>
                <button
                  onClick={() => window.api.shell.openInChrome(p.prLink!).catch((err) => reportError(err, 'Open PR in browser'))}
                  style={{ fontSize: 12, color: 'hsl(var(--primary))', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
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
      <PrHeader prLink={task.prLink} branchName={task.branchName} />

      {/* Diff section */}
      {hasChanges && (
        <>
          <DiffSummaryBar files={fileDiffs} />
          <FileNav files={fileDiffs} onJump={jumpToFile} />
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
        <div style={{
          padding: 48, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13,
          background: 'hsl(var(--surface-2) / 0.3)', borderRadius: 12,
        }}>
          No implementation data yet. Diffs and PR link will appear after the implementor agent completes.
        </div>
      )}

      {/* Implementation review output from reviewer agent */}
      <ImplementationReviewSection contextEntries={contextEntries} />

      {/* Previous change request comments */}
      {changeRequests.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Change Requests
          </div>
          {changeRequests.map((entry) => (
            <div
              key={entry.id}
              style={{
                borderRadius: 10, padding: '10px 14px',
                marginBottom: 8, fontSize: 13,
                background: 'hsl(var(--card))',
                boxShadow: '0 1px 3px hsl(var(--foreground) / 0.04), 0 0 0 1px hsl(var(--border))',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: 'var(--muted-foreground)' }}>
                <span style={{ fontWeight: 500 }}>{entry.source}</span>
                <span>{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{entry.summary}</div>
            </div>
          ))}
        </div>
      )}

      {/* Comment input + actions */}
      {(canRequestChanges || mergeTransition || approveTransition) && (
        <div style={{
          borderTop: '1px solid hsl(var(--border) / 0.5)', paddingTop: 16, marginTop: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Feedback
          </div>
          <Textarea
            placeholder="Describe the changes needed..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            style={{ marginBottom: 10, fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace", fontSize: 13 }}
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
