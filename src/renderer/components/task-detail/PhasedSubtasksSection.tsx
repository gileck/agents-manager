import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import type { ImplementationPhase, SubtaskStatus } from '../../../shared/types';

interface PhasedSubtasksSectionProps {
  taskId: string;
  phases: ImplementationPhase[];
  onUpdate: () => void;
}

export function PhasedSubtasksSection({
  taskId,
  phases,
  onUpdate,
}: PhasedSubtasksSectionProps) {
  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const p of phases) {
      initial[p.id] = p.status === 'in_progress';
    }
    return initial;
  });

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => ({ ...prev, [phaseId]: !prev[phaseId] }));
  };

  const cycleSubtaskStatus = async (phaseIdx: number, subtaskIdx: number) => {
    const order: SubtaskStatus[] = ['open', 'in_progress', 'done'];
    const phase = phases[phaseIdx];
    const current = (phase.subtasks ?? [])[subtaskIdx].status;
    const next = order[(order.indexOf(current) + 1) % order.length];
    const updatedPhases = phases.map((p, pi) =>
      pi === phaseIdx
        ? { ...p, subtasks: (p.subtasks ?? []).map((s, si) => si === subtaskIdx ? { ...s, status: next } : s) }
        : p
    );
    try {
      await window.api.tasks.update(taskId, { phases: updatedPhases });
      onUpdate();
    } catch (err) {
      console.error('Failed to cycle subtask status', err);
    }
  };

  const totalSubtasks = phases.reduce((sum, p) => sum + (p.subtasks ?? []).length, 0);
  const totalDone = phases.reduce((sum, p) => sum + (p.subtasks ?? []).filter(s => s.status === 'done').length, 0);
  const completedPhases = phases.filter(p => p.status === 'completed').length;

  const phaseStatusColor = (status: string) => {
    if (status === 'completed') return '#22c55e';
    if (status === 'in_progress') return '#3b82f6';
    return '#9ca3af';
  };

  return (
    <Card className="mt-4">
      <CardHeader className="py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Implementation Phases
          <span className="text-sm font-normal text-muted-foreground ml-2">
            {completedPhases}/{phases.length} phases &middot; {totalDone}/{totalSubtasks} subtasks done
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Overall progress bar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: totalSubtasks > 0 ? `${(totalDone / totalSubtasks) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {totalSubtasks > 0 ? Math.round((totalDone / totalSubtasks) * 100) : 0}%
          </span>
        </div>

        <div className="space-y-2">
          {phases.map((phase, phaseIdx) => {
            const phaseDone = (phase.subtasks ?? []).filter(s => s.status === 'done').length;
            const isExpanded = expandedPhases[phase.id] ?? false;

            return (
              <div key={phase.id} className="border rounded-md overflow-hidden">
                <button
                  onClick={() => togglePhase(phase.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                >
                  <span className="text-xs" style={{ color: phaseStatusColor(phase.status) }}>
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: phaseStatusColor(phase.status) }}
                  />
                  <span className="text-sm font-medium flex-1 truncate">{phase.name}</span>
                  <Badge
                    variant={phase.status === 'completed' ? 'success' : phase.status === 'in_progress' ? 'default' : 'outline'}
                    className="text-xs"
                  >
                    {phase.status.replace('_', ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {phaseDone}/{(phase.subtasks ?? []).length}
                  </span>
                  {phase.prLink && (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.api.shell.openInChrome(phase.prLink!); }}
                      className="text-xs text-blue-500 hover:underline ml-1"
                    >
                      PR
                    </button>
                  )}
                </button>

                {isExpanded && (phase.subtasks ?? []).length > 0 && (
                  <div className="px-3 pb-2 space-y-1">
                    {(phase.subtasks ?? []).map((st, stIdx) => (
                      <div key={stIdx} className="flex items-center gap-2 group py-1 pl-4">
                        <button
                          onClick={() => cycleSubtaskStatus(phaseIdx, stIdx)}
                          className="flex items-center justify-center w-4 h-4 rounded-full border-2 shrink-0 transition-colors"
                          style={{
                            borderColor: st.status === 'done' ? '#22c55e' : st.status === 'in_progress' ? '#3b82f6' : '#d1d5db',
                            backgroundColor: st.status === 'done' ? '#22c55e' : 'transparent',
                          }}
                          title={`Status: ${st.status} (click to cycle)`}
                        >
                          {st.status === 'done' && (
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6l2.5 2.5 4.5-4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {st.status === 'in_progress' && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#3b82f6' }} />
                          )}
                        </button>
                        <span
                          className="text-sm flex-1"
                          style={{
                            textDecoration: st.status === 'done' ? 'line-through' : undefined,
                            color: st.status === 'done' ? '#9ca3af' : undefined,
                          }}
                        >
                          {st.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
