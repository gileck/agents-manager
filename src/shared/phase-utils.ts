import type { ImplementationPhase, Subtask, Task } from './types';

/** Returns the active phase (first in_progress, then first pending). */
export function getActivePhase(phases: ImplementationPhase[] | null | undefined): ImplementationPhase | null {
  if (!phases || phases.length === 0) return null;
  return phases.find(p => p.status === 'in_progress')
    ?? phases.find(p => p.status === 'pending')
    ?? null;
}

/** Returns the 0-based index of the active phase, or -1 if none. */
export function getActivePhaseIndex(phases: ImplementationPhase[] | null | undefined): number {
  if (!phases || phases.length === 0) return -1;
  const idx = phases.findIndex(p => p.status === 'in_progress');
  if (idx !== -1) return idx;
  return phases.findIndex(p => p.status === 'pending');
}

/** Returns true if the task has multiple implementation phases. */
export function isMultiPhase(task: Pick<Task, 'phases'>): boolean {
  return !!task.phases && task.phases.length > 1;
}

/** Returns true if there are any uncompleted phases remaining (pending or in_progress). */
export function hasPendingPhases(phases: ImplementationPhase[] | null | undefined): boolean {
  if (!phases || phases.length === 0) return false;
  return phases.some(p => p.status !== 'completed');
}

/** Flattens all subtasks from all phases into a single array. */
export function getAllSubtasksFromPhases(phases: ImplementationPhase[] | null | undefined): Subtask[] {
  if (!phases || phases.length === 0) return [];
  return phases.flatMap(p => p.subtasks);
}
