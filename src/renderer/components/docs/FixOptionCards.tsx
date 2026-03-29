import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { MarkdownContent } from '../chat/MarkdownContent';
import { reportError } from '../../lib/error-handler';
import { buildFixOptionSummary } from '../../utils/fix-option-summary';
import type { ProposedFixOption, Transition, TaskType } from '../../../shared/types';

const ESCAPE_STATUSES = new Set(['backlog', 'closed']);
function isEscapeTransition(t: Transition): boolean {
  return ESCAPE_STATUSES.has(t.to);
}

// ─── Size → target status mapping ─────────────────────────────────────────────

type FixSize = 'S' | 'M' | 'L' | 'XL';

const SIZE_DEFAULTS: Record<FixSize, string> = {
  S: 'implementing',
  M: 'planning',
  L: 'designing',
  XL: 'designing',
};

const SIZE_LABELS: Record<FixSize, string> = {
  S: 'Implement',
  M: 'Plan',
  L: 'Design',
  XL: 'Design',
};

const SIZE_COLORS: Record<FixSize, { bg: string; text: string; border: string }> = {
  S: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  M: { bg: '#fef9c3', text: '#854d0e', border: '#fde047' },
  L: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  XL: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
};

/** Override target statuses available in the dropdown. */
const OVERRIDE_TARGETS = [
  { status: 'implementing', label: 'Implement' },
  { status: 'planning', label: 'Plan' },
  { status: 'designing', label: 'Design' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Infer size from label prefix if the explicit size field is missing. */
function inferSize(option: ProposedFixOption): FixSize {
  if (option.size) return option.size;
  const label = option.label.trim();
  if (label.startsWith('S ') || label.startsWith('S—') || label.startsWith('S —')) return 'S';
  if (label.startsWith('M ') || label.startsWith('M—') || label.startsWith('M —')) return 'M';
  if (label.startsWith('L ') || label.startsWith('L—') || label.startsWith('L —')) return 'L';
  if (label.startsWith('XL ') || label.startsWith('XL—') || label.startsWith('XL —')) return 'XL';
  return 'M'; // default to medium
}

/** Get the default target status for a given size, falling back if the transition isn't available. */
function getDefaultTarget(size: FixSize, transitions: Transition[]): string {
  const preferred = SIZE_DEFAULTS[size];
  if (transitions.some(t => t.to === preferred)) return preferred;
  // Fall back to implementing
  if (transitions.some(t => t.to === 'implementing')) return 'implementing';
  return transitions[0]?.to ?? 'implementing';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface FixOptionCardsProps {
  options: ProposedFixOption[];
  taskId: string;
  taskTitle: string;
  transitions: Transition[];
  transitioning: string | null;
  onTransition: (toStatus: string) => void;
  /** Compact mode for StatusActionBar — shows smaller cards. */
  compact?: boolean;
  /** Parent task type — used when creating a new task from a fix option. */
  taskType?: TaskType;
}

export function FixOptionCards({
  options,
  taskId,
  taskTitle,
  transitions,
  transitioning,
  onTransition,
  compact = false,
  taskType,
}: FixOptionCardsProps) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [creatingTaskForId, setCreatingTaskForId] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Forward transitions only (for the fix option cards' primary actions)
  const forwardTransitions = transitions.filter(
    t => t.to === 'implementing' || t.to === 'planning' || t.to === 'designing'
  );

  // Non-forward transitions (e.g. "Request Investigation Changes") — rendered separately
  const secondaryTransitions = transitions.filter(
    t => !forwardTransitions.some(ft => ft.to === t.to) && !isEscapeTransition(t)
  );

  const handleSelectOption = useCallback(async (option: ProposedFixOption) => {
    if (saving) return;
    const size = inferSize(option);
    const target = overrideTarget[option.id] ?? getDefaultTarget(size, forwardTransitions);

    setSaving(true);
    try {
      await window.api.tasks.addContextEntry(taskId, {
        source: 'user',
        entryType: 'fix_option_selected',
        summary: buildFixOptionSummary(option),
        data: { option },
      });
      onTransition(target);
    } catch (err) {
      reportError(err, 'Save fix option selection');
    } finally {
      setSaving(false);
    }
  }, [saving, taskId, overrideTarget, forwardTransitions, onTransition]);

  const handleCreateTask = useCallback(async (option: ProposedFixOption) => {
    setCreatingTaskForId(option.id);
    try {
      const settings = await window.api.settings.get();
      const projectId = settings.currentProjectId;
      if (!projectId) { toast.error('No project selected'); return; }

      let pipelineId = settings.defaultPipelineId;
      if (!pipelineId) {
        const pipelines = await window.api.pipelines.list();
        pipelineId = pipelines[0]?.id;
      }
      if (!pipelineId) { toast.error('No pipeline configured'); return; }

      const description = [
        option.description,
        '',
        `---`,
        `*Created from fix option on task [${taskTitle}](/tasks/${taskId}).*`,
      ].join('\n');

      const created = await window.api.tasks.create({
        projectId,
        pipelineId,
        title: option.label,
        description,
        type: taskType ?? 'improvement',
        priority: 2,
        tags: ['fix-option'],
        metadata: { sourceTaskId: taskId, fixOptionId: option.id },
        createdBy: 'user',
      });

      toast.success('Task created', {
        action: { label: 'View', onClick: () => navigate(`/tasks/${created.id}`) },
      });
    } catch (err) {
      reportError(err, 'Create task from fix option');
    } finally {
      setCreatingTaskForId(null);
    }
  }, [taskId, taskTitle, navigate]);

  const isDisabled = transitioning !== null || saving;

  return (
    <div style={{ marginTop: compact ? 8 : 16, paddingTop: compact ? 8 : 16, borderTop: compact ? 'none' : '1px solid var(--border)' }}>
      {!compact && (
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--foreground)' }}>
          Fix Options
        </h4>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 12 }}>
        {options.map((option) => {
          const size = inferSize(option);
          const colors = SIZE_COLORS[size];
          const resolvedTarget = overrideTarget[option.id] ?? getDefaultTarget(size, forwardTransitions);
          const buttonLabel = OVERRIDE_TARGETS.find(t => t.status === resolvedTarget)?.label ?? SIZE_LABELS[size];
          const isExpanded = expandedId === option.id;

          return (
            <div
              key={option.id}
              style={{
                border: option.recommended
                  ? '2px solid rgb(59, 130, 246)'
                  : '1px solid var(--border)',
                borderRadius: 8,
                padding: compact ? '10px 12px' : '14px 16px',
                background: option.recommended
                  ? 'rgba(59, 130, 246, 0.04)'
                  : 'var(--background)',
              }}
            >
              {/* Header row: size badge + label + recommended */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Size badge */}
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 28,
                  height: 22,
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: colors.bg,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  padding: '0 6px',
                  flexShrink: 0,
                }}>
                  {size}
                </span>

                {/* Label */}
                <span style={{
                  flex: 1,
                  fontSize: compact ? 13 : 14,
                  fontWeight: 600,
                  color: 'var(--foreground)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: compact ? 'nowrap' : undefined,
                }}>
                  {option.label}
                </span>

                {/* Recommended badge */}
                {option.recommended && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 4,
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    color: 'rgb(59, 130, 246)',
                    flexShrink: 0,
                  }}>
                    ★ Recommended
                  </span>
                )}
              </div>

              {/* Description — always visible in full mode, toggle in compact */}
              {!compact && option.description && (
                <div style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: 'var(--muted-foreground)',
                  lineHeight: 1.5,
                }}>
                  <MarkdownContent content={option.description} />
                </div>
              )}

              {compact && option.description && (
                <div style={{ marginTop: 4 }}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : option.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 11,
                      color: 'var(--muted-foreground)',
                      padding: 0,
                    }}
                  >
                    {isExpanded ? '▾ Hide details' : '▸ Details'}
                  </button>
                  {isExpanded && (
                    <div style={{
                      marginTop: 4,
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--muted)',
                      fontSize: 12,
                    }}>
                      <MarkdownContent content={option.description} />
                    </div>
                  )}
                </div>
              )}

              {/* Action row */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: compact ? 8 : 12,
                flexWrap: 'wrap',
              }}>
                {/* Primary action button */}
                <Button
                  size="sm"
                  onClick={() => handleSelectOption(option)}
                  disabled={isDisabled}
                >
                  {saving ? 'Saving...' : `${buttonLabel} →`}
                </Button>

                {/* Override target dropdown */}
                {forwardTransitions.length > 1 && (
                  <select
                    value={resolvedTarget}
                    onChange={(e) => setOverrideTarget(prev => ({ ...prev, [option.id]: e.target.value }))}
                    disabled={isDisabled}
                    title="Override target phase"
                    style={{
                      fontSize: 12,
                      padding: '4px 6px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'var(--background)',
                      color: 'var(--muted-foreground)',
                      cursor: 'pointer',
                    }}
                  >
                    {OVERRIDE_TARGETS
                      .filter(t => forwardTransitions.some(ft => ft.to === t.status))
                      .map(t => (
                        <option key={t.status} value={t.status}>{t.label}</option>
                      ))
                    }
                  </select>
                )}

                {/* Create as new task button */}
                <button
                  onClick={() => handleCreateTask(option)}
                  disabled={isDisabled || creatingTaskForId === option.id}
                  title="Create a new task from this fix option"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 12,
                    color: 'var(--muted-foreground)',
                    cursor: isDisabled || creatingTaskForId === option.id ? 'not-allowed' : 'pointer',
                    opacity: isDisabled || creatingTaskForId === option.id ? 0.5 : 1,
                  }}
                >
                  {creatingTaskForId === option.id ? 'Creating...' : 'Create Task ↗'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Secondary transitions — non-forward, non-escape (e.g. "Request Investigation Changes") */}
      {secondaryTransitions.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: compact ? 8 : 12,
          flexWrap: 'wrap',
        }}>
          {secondaryTransitions.map((t) => (
            <Button
              key={t.to}
              variant="outline"
              size="sm"
              onClick={() => onTransition(t.to)}
              disabled={isDisabled}
            >
              {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
