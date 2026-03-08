import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import type { TaskArtifact, Transition, TaskContextEntry, ImplementationPhase } from '../../../shared/types';
import { ImplementationReviewSection } from '../task-detail/ImplementationReviewSection';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { reportError } from '../../lib/error-handler';
import { MarkdownContent } from '../chat/MarkdownContent';

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

/** Merge FileDiffs that share the same filename into a single entry. */
function mergeDiffsByFile(diffs: FileDiff[]): FileDiff[] {
  const map = new Map<string, FileDiff>();
  for (const d of diffs) {
    const existing = map.get(d.filename);
    if (existing) {
      existing.additions += d.additions;
      existing.deletions += d.deletions;
      existing.lines.push(...d.lines);
    } else {
      map.set(d.filename, { ...d, lines: [...d.lines] });
    }
  }
  return Array.from(map.values());
}

/** Reconstruct a copyable unified diff string from parsed lines. */
function fileDiffToString(file: FileDiff): string {
  const header = `--- a/${file.filename}\n+++ b/${file.filename}\n`;
  const body = file.lines.map(l => {
    if (l.type === 'hunk-header') return l.content;
    if (l.type === 'addition') return `+${l.content}`;
    if (l.type === 'deletion') return `-${l.content}`;
    return ` ${l.content}`;
  }).join('\n');
  return header + body;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitPath(filepath: string): { dir: string; base: string } {
  const idx = filepath.lastIndexOf('/');
  return idx < 0 ? { dir: '', base: filepath } : { dir: filepath.slice(0, idx + 1), base: filepath.slice(idx + 1) };
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch((err) => reportError(err, 'Copy to clipboard'));
  };
  return (
    <span
      onClick={handleCopy}
      style={{
        fontSize: 10, color: copied ? 'hsl(var(--success))' : 'hsl(var(--muted-foreground) / 0.6)',
        fontWeight: 500, flexShrink: 0, padding: '2px 6px', borderRadius: 4,
        cursor: 'pointer', transition: 'color 100ms ease', userSelect: 'none',
      }}
      className="hover:text-foreground"
      title={label ?? 'Copy diff'}
    >
      {copied ? 'Copied!' : 'Copy'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Line context menu
// ---------------------------------------------------------------------------

interface LineMenuData {
  x: number;
  y: number;
  filename: string;
  lineNum: number;
  code: string;
}

function LineContextMenu({
  data,
  projectPath,
  onQuote,
  onClose,
}: {
  data: LineMenuData;
  projectPath: string | null;
  onQuote: (text: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('keydown', handleKey); };
  }, [onClose]);

  const handleOpenVscode = () => {
    if (!projectPath) return;
    window.api.shell.openFileInVscode(`${projectPath}/${data.filename}`, data.lineNum).catch((err) =>
      reportError(err, `Open ${data.filename} in VS Code`),
    );
    onClose();
  };

  const handleQuote = () => {
    const prefix = data.code.trim() ? `\`${data.filename}:${data.lineNum}\`\n\`\`\`\n${data.code}\n\`\`\`\n` : `\`${data.filename}:${data.lineNum}\`\n`;
    onQuote(prefix);
    onClose();
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left: data.x, top: data.y, zIndex: 100,
        background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))',
        borderRadius: 8, padding: 4, minWidth: 170,
        boxShadow: '0 4px 16px hsl(var(--foreground) / 0.12), 0 1px 4px hsl(var(--foreground) / 0.06)',
      }}
    >
      {projectPath && (
        <button
          onClick={handleOpenVscode}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '6px 10px', border: 'none', background: 'transparent',
            cursor: 'pointer', fontSize: 12, borderRadius: 5, textAlign: 'left',
            color: 'var(--foreground)', transition: 'background 80ms ease',
          }}
          className="hover:bg-accent"
        >
          <span style={{ fontSize: 13, width: 18, textAlign: 'center', opacity: 0.7 }}>&#x2197;</span>
          Open in VS Code
        </button>
      )}
      <button
        onClick={handleQuote}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '6px 10px', border: 'none', background: 'transparent',
          cursor: 'pointer', fontSize: 12, borderRadius: 5, textAlign: 'left',
          color: 'var(--foreground)', transition: 'background 80ms ease',
        }}
        className="hover:bg-accent"
      >
        <span style={{ fontSize: 13, width: 18, textAlign: 'center', opacity: 0.7 }}>&#x201C;</span>
        Quote in Feedback
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffProgressBar({ additions, deletions, width = 40 }: { additions: number; deletions: number; width?: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const addWidth = Math.round((additions / total) * width);
  return (
    <span style={{ display: 'inline-flex', height: 5, width, borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
      <span style={{ width: addWidth, background: 'hsl(var(--success) / 0.7)' }} />
      <span style={{ width: width - addWidth, background: 'hsl(var(--destructive) / 0.7)' }} />
    </span>
  );
}

function DiffSummaryBar({
  files,
  allExpanded,
  onToggleAll,
  fullDiffText,
}: {
  files: FileDiff[];
  allExpanded: boolean;
  onToggleAll: () => void;
  fullDiffText: string;
}) {
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0', marginBottom: 4, fontSize: 12, color: 'var(--muted-foreground)',
    }}>
      <span style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: 13 }}>
        {files.length} file{files.length !== 1 ? 's' : ''} changed
      </span>
      {totalAdd > 0 && <span style={{ color: 'hsl(var(--success))', fontWeight: 600 }}>+{totalAdd}</span>}
      {totalDel > 0 && <span style={{ color: 'hsl(var(--destructive))', fontWeight: 600 }}>-{totalDel}</span>}
      <DiffProgressBar additions={totalAdd} deletions={totalDel} width={56} />
      <span style={{ flex: 1 }} />
      <CopyButton text={fullDiffText} label="Copy all diffs" />
      <span style={{ width: 1, height: 12, background: 'hsl(var(--border) / 0.5)' }} />
      <button
        onClick={onToggleAll}
        style={{
          fontSize: 11, color: 'hsl(var(--primary) / 0.8)', cursor: 'pointer',
          background: 'none', border: 'none', fontWeight: 500,
          transition: 'color 80ms ease',
        }}
        className="hover:text-primary"
      >
        {allExpanded ? 'Collapse all' : 'Expand all'}
      </button>
    </div>
  );
}

function FileDiffCard({
  file,
  fileRef,
  projectPath,
  open,
  onToggle,
  onLineClick,
}: {
  file: FileDiff;
  fileRef: React.RefObject<HTMLDivElement | null>;
  projectPath: string | null;
  open: boolean;
  onToggle: () => void;
  onLineClick: (e: React.MouseEvent, filename: string, lineNum: number, code: string) => void;
}) {
  const { dir, base } = splitPath(file.filename);

  const openInVscode = useCallback(() => {
    if (!projectPath) return;
    window.api.shell.openFileInVscode(`${projectPath}/${file.filename}`).catch((err) =>
      reportError(err, `Open ${file.filename} in VS Code`),
    );
  }, [projectPath, file.filename]);

  return (
    <div
      ref={fileRef}
      style={{
        borderRadius: 8, overflow: 'hidden',
        border: '1px solid hsl(var(--border) / 0.7)',
      }}
    >
      {/* File header */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '7px 12px', border: 'none',
          background: open ? 'hsl(var(--muted) / 0.5)' : 'transparent',
          cursor: 'pointer', textAlign: 'left',
          borderBottom: open ? '1px solid hsl(var(--border) / 0.5)' : 'none',
          transition: 'background 100ms ease',
        }}
        className="hover:bg-muted/40"
      >
        <span style={{
          fontSize: 9, color: 'var(--muted-foreground)',
          transition: 'transform 100ms ease',
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          display: 'inline-block',
        }}>
          &#9660;
        </span>
        <span style={{
          fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
          fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span style={{ color: 'var(--muted-foreground)' }}>{dir}</span>
          <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{base}</span>
        </span>
        <span style={{ display: 'flex', gap: 5, fontSize: 11, flexShrink: 0, fontFamily: 'monospace' }}>
          {file.additions > 0 && <span style={{ color: 'hsl(var(--success))', fontWeight: 600 }}>+{file.additions}</span>}
          {file.deletions > 0 && <span style={{ color: 'hsl(var(--destructive))', fontWeight: 600 }}>-{file.deletions}</span>}
        </span>
        <DiffProgressBar additions={file.additions} deletions={file.deletions} />
        {projectPath && (
          <span
            onClick={(e) => { e.stopPropagation(); openInVscode(); }}
            style={{
              fontSize: 10, color: 'hsl(var(--primary) / 0.7)', fontWeight: 500, flexShrink: 0,
              padding: '2px 6px', borderRadius: 4, transition: 'color 100ms ease',
            }}
            className="hover:text-primary"
            title="Open in VS Code"
          >
            VS Code
          </span>
        )}
        <CopyButton text={fileDiffToString(file)} label={`Copy diff for ${file.filename}`} />
      </button>

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
                        padding: '4px 14px',
                        background: 'hsl(var(--primary) / 0.03)',
                        color: 'var(--muted-foreground)', fontSize: 11,
                        borderTop: i > 0 ? '1px solid hsl(var(--border) / 0.4)' : 'none',
                        borderBottom: '1px solid hsl(var(--border) / 0.4)',
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
                  ? 'hsl(var(--success) / 0.09)'
                  : isDel
                    ? 'hsl(var(--destructive) / 0.09)'
                    : 'transparent';
                const lineNum = line.newLine ?? line.oldLine;
                const hasLineNum = lineNum !== undefined;

                return (
                  <tr key={i} style={{ background: bg }} className="diff-line-row">
                    <td
                      style={{
                        width: 44, minWidth: 44, textAlign: 'right',
                        padding: '0 8px', color: 'hsl(var(--muted-foreground) / 0.5)',
                        background: gutterBg, userSelect: 'none',
                        fontSize: 11, verticalAlign: 'top', lineHeight: '20px',
                        cursor: hasLineNum ? 'pointer' : 'default',
                        borderRight: '1px solid hsl(var(--border) / 0.3)',
                      }}
                      onClick={hasLineNum ? (e) => onLineClick(e, file.filename, line.oldLine ?? line.newLine!, line.content) : undefined}
                    >
                      {isDel ? line.oldLine : line.type === 'context' ? line.oldLine : ''}
                    </td>
                    <td
                      style={{
                        width: 44, minWidth: 44, textAlign: 'right',
                        padding: '0 8px', color: 'hsl(var(--muted-foreground) / 0.5)',
                        background: gutterBg, userSelect: 'none',
                        fontSize: 11, verticalAlign: 'top', lineHeight: '20px',
                        cursor: hasLineNum ? 'pointer' : 'default',
                        borderRight: '1px solid hsl(var(--border) / 0.3)',
                      }}
                      onClick={hasLineNum ? (e) => onLineClick(e, file.filename, line.newLine ?? line.oldLine!, line.content) : undefined}
                    >
                      {isAdd ? line.newLine : line.type === 'context' ? line.newLine : ''}
                    </td>
                    <td style={{
                      padding: '0 14px', whiteSpace: 'pre', overflow: 'visible',
                      color: isAdd
                        ? 'hsl(var(--success) / 0.85)'
                        : isDel
                          ? 'hsl(var(--destructive) / 0.85)'
                          : 'var(--foreground)',
                    }}>
                      <span style={{ userSelect: 'none', display: 'inline-block', width: 14, opacity: 0.45, textAlign: 'center' }}>
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
      padding: '12px 14px', marginBottom: 14,
      borderRadius: 8, border: '1px solid hsl(var(--border) / 0.7)',
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 7,
        background: 'hsl(var(--success) / 0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'hsl(var(--success))' }}>
          <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          onClick={() => window.api.shell.openInChrome(prLink).catch((err) => reportError(err, 'Open PR in browser'))}
          style={{
            fontSize: 13, color: 'hsl(var(--primary))', cursor: 'pointer',
            background: 'none', border: 'none', textAlign: 'left',
            fontWeight: 600, padding: 0,
          }}
          className="hover:underline"
        >
          Pull Request {prNumber}
        </button>
        {branchName && (
          <div style={{ marginTop: 2 }}>
            <code style={{
              padding: '1px 7px', borderRadius: 4,
              background: 'hsl(var(--muted) / 0.7)',
              color: 'var(--muted-foreground)',
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
          fontSize: 12, padding: '5px 12px', borderRadius: 6,
          background: 'transparent', border: '1px solid hsl(var(--border))',
          color: 'var(--foreground)', cursor: 'pointer', flexShrink: 0, fontWeight: 500,
          transition: 'background 100ms ease',
        }}
        className="hover:bg-muted/60"
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
  const feedbackRef = useRef<HTMLTextAreaElement>(null);

  // Context menu state
  const [lineMenu, setLineMenu] = useState<LineMenuData | null>(null);

  const fileDiffs = useMemo(() => {
    const diffArtifacts = artifacts?.filter((a) => a.type === 'diff') ?? [];
    const allDiffs: FileDiff[] = [];
    for (const artifact of diffArtifacts) {
      const raw = (artifact.data as { diff?: string } | undefined)?.diff ?? '';
      allDiffs.push(...parseDiff(raw));
    }
    return mergeDiffsByFile(allDiffs);
  }, [artifacts]);

  // Expanded state per file — default all collapsed
  const [expandedSet, setExpandedSet] = useState<Set<number>>(() => new Set());

  // Reset expanded state when file list changes
  useEffect(() => { setExpandedSet(new Set()); }, [fileDiffs]);

  const allExpanded = fileDiffs.length > 0 && expandedSet.size === fileDiffs.length;

  const toggleAll = useCallback(() => {
    if (allExpanded) {
      setExpandedSet(new Set());
    } else {
      setExpandedSet(new Set(fileDiffs.map((_, i) => i)));
    }
  }, [allExpanded, fileDiffs]);

  const toggleFile = useCallback((idx: number) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const fileRefs = useMemo(
    () => fileDiffs.map(() => React.createRef<HTMLDivElement>()),
    [fileDiffs],
  );

  const handleLineClick = useCallback((e: React.MouseEvent, filename: string, lineNum: number, code: string) => {
    setLineMenu({ x: e.clientX, y: e.clientY, filename, lineNum, code });
  }, []);

  const handleQuote = useCallback((text: string) => {
    setComment(prev => {
      const separator = prev && !prev.endsWith('\n') ? '\n' : '';
      return prev + separator + text;
    });
    // Focus the feedback textarea after quoting
    setTimeout(() => feedbackRef.current?.focus(), 50);
  }, []);

  const changeRequests = useMemo(
    () => (contextEntries ?? []).filter((e) => e.entryType === 'change_request'),
    [contextEntries],
  );

  const implementationSummary = useMemo(
    () =>
      (contextEntries ?? [])
        .filter((e) => e.entryType === 'implementation_summary')
        .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null,
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
      {/* Line context menu */}
      {lineMenu && (
        <LineContextMenu
          data={lineMenu}
          projectPath={projectPath}
          onQuote={handleQuote}
          onClose={() => setLineMenu(null)}
        />
      )}

      {/* Phase indicator */}
      {isMultiPhase && activePhaseIdx >= 0 && (
        <div style={{
          marginBottom: 14, padding: '7px 12px', borderRadius: 6,
          border: '1px solid hsl(var(--primary) / 0.15)',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            fontWeight: 600, fontSize: 11, padding: '1px 7px', borderRadius: 4,
            background: 'hsl(var(--primary) / 0.08)', color: 'hsl(var(--primary))',
          }}>
            Phase {activePhaseIdx + 1}/{phases!.length}
          </span>
          <span style={{ color: 'var(--muted-foreground)' }}>{phases![activePhaseIdx].name}</span>
        </div>
      )}

      {/* Completed phase PRs */}
      {completedPhases.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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

      {/* Implementation Summary */}
      {implementationSummary && (
        <div style={{
          marginBottom: 14, borderRadius: 8, padding: '12px 14px',
          border: '1px solid hsl(var(--border) / 0.7)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Implementation Summary
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <MarkdownContent content={implementationSummary.summary} />
          </div>
        </div>
      )}

      {/* Unified file changes + diffs */}
      {hasChanges && (
        <div>
          <DiffSummaryBar
            files={fileDiffs}
            allExpanded={allExpanded}
            onToggleAll={toggleAll}
            fullDiffText={fileDiffs.map(f => fileDiffToString(f)).join('\n\n')}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {fileDiffs.map((f, i) => (
              <FileDiffCard
                key={`${f.filename}-${i}`}
                file={f}
                fileRef={fileRefs[i]}
                projectPath={projectPath}
                open={expandedSet.has(i)}
                onToggle={() => toggleFile(i)}
                onLineClick={handleLineClick}
              />
            ))}
          </div>
        </div>
      )}

      {!hasContent && (
        <div style={{
          padding: 48, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13,
          border: '1px dashed hsl(var(--border))', borderRadius: 8,
        }}>
          No implementation data yet. Diffs and PR link will appear after the implementor agent completes.
        </div>
      )}

      {/* Implementation review */}
      <ImplementationReviewSection contextEntries={contextEntries} />

      {/* Change requests */}
      {changeRequests.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Change Requests
          </div>
          {changeRequests.map((entry) => (
            <div
              key={entry.id}
              style={{
                borderRadius: 8, padding: '10px 14px',
                marginBottom: 8, fontSize: 13,
                border: '1px solid hsl(var(--border) / 0.7)',
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

      {/* Feedback */}
      {(canRequestChanges || mergeTransition || approveTransition) && (
        <div style={{ borderTop: '1px solid hsl(var(--border) / 0.5)', paddingTop: 16, marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Feedback
          </div>
          <Textarea
            ref={feedbackRef}
            placeholder="Describe the changes needed... Click a line number to quote code."
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
