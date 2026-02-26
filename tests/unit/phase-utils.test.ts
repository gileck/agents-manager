import { describe, it, expect } from 'vitest';
import {
  getActivePhase,
  getActivePhaseIndex,
  hasPendingPhases,
  isMultiPhase,
  getAllSubtasksFromPhases,
} from '../../src/shared/phase-utils';
import type { ImplementationPhase } from '../../src/shared/types';

function makePhase(
  id: string,
  status: ImplementationPhase['status'],
  subtasks: { name: string; status: 'open' | 'in_progress' | 'done' }[] = [],
): ImplementationPhase {
  return { id, name: `Phase ${id}`, status, subtasks };
}

describe('phase-utils', () => {
  describe('getActivePhase', () => {
    it('returns null for null/undefined/empty phases', () => {
      expect(getActivePhase(null)).toBeNull();
      expect(getActivePhase(undefined)).toBeNull();
      expect(getActivePhase([])).toBeNull();
    });

    it('returns the first in_progress phase', () => {
      const phases = [
        makePhase('1', 'completed'),
        makePhase('2', 'in_progress'),
        makePhase('3', 'pending'),
      ];
      expect(getActivePhase(phases)).toBe(phases[1]);
    });

    it('returns the first pending phase when none is in_progress', () => {
      const phases = [
        makePhase('1', 'completed'),
        makePhase('2', 'pending'),
        makePhase('3', 'pending'),
      ];
      expect(getActivePhase(phases)).toBe(phases[1]);
    });

    it('returns null when all phases are completed', () => {
      const phases = [
        makePhase('1', 'completed'),
        makePhase('2', 'completed'),
      ];
      expect(getActivePhase(phases)).toBeNull();
    });

    it('prefers in_progress over pending', () => {
      const phases = [
        makePhase('1', 'pending'),
        makePhase('2', 'in_progress'),
      ];
      expect(getActivePhase(phases)).toBe(phases[1]);
    });
  });

  describe('getActivePhaseIndex', () => {
    it('returns -1 for null/undefined/empty phases', () => {
      expect(getActivePhaseIndex(null)).toBe(-1);
      expect(getActivePhaseIndex(undefined)).toBe(-1);
      expect(getActivePhaseIndex([])).toBe(-1);
    });

    it('returns the index of the first in_progress phase', () => {
      const phases = [
        makePhase('1', 'completed'),
        makePhase('2', 'in_progress'),
        makePhase('3', 'pending'),
      ];
      expect(getActivePhaseIndex(phases)).toBe(1);
    });

    it('returns the index of the first pending phase when none is in_progress', () => {
      const phases = [
        makePhase('1', 'completed'),
        makePhase('2', 'completed'),
        makePhase('3', 'pending'),
      ];
      expect(getActivePhaseIndex(phases)).toBe(2);
    });

    it('returns -1 when all phases are completed', () => {
      const phases = [
        makePhase('1', 'completed'),
        makePhase('2', 'completed'),
      ];
      expect(getActivePhaseIndex(phases)).toBe(-1);
    });
  });

  describe('hasPendingPhases', () => {
    it('returns false for null/undefined/empty phases', () => {
      expect(hasPendingPhases(null)).toBe(false);
      expect(hasPendingPhases(undefined)).toBe(false);
      expect(hasPendingPhases([])).toBe(false);
    });

    it('returns true when there are pending phases', () => {
      const phases = [
        makePhase('1', 'completed'),
        makePhase('2', 'pending'),
      ];
      expect(hasPendingPhases(phases)).toBe(true);
    });

    it('returns true when there are in_progress phases (crash recovery)', () => {
      const phases = [
        makePhase('1', 'completed'),
        makePhase('2', 'in_progress'),
      ];
      expect(hasPendingPhases(phases)).toBe(true);
    });

    it('returns false when all phases are completed', () => {
      const phases = [
        makePhase('1', 'completed'),
        makePhase('2', 'completed'),
      ];
      expect(hasPendingPhases(phases)).toBe(false);
    });
  });

  describe('isMultiPhase', () => {
    it('returns false for null/undefined/empty phases', () => {
      expect(isMultiPhase({ phases: null })).toBe(false);
      expect(isMultiPhase({ phases: [] })).toBe(false);
    });

    it('returns false for a single phase', () => {
      expect(isMultiPhase({ phases: [makePhase('1', 'pending')] })).toBe(false);
    });

    it('returns true for multiple phases', () => {
      expect(isMultiPhase({
        phases: [makePhase('1', 'completed'), makePhase('2', 'pending')],
      })).toBe(true);
    });
  });

  describe('getAllSubtasksFromPhases', () => {
    it('returns empty array for null/undefined/empty phases', () => {
      expect(getAllSubtasksFromPhases(null)).toEqual([]);
      expect(getAllSubtasksFromPhases(undefined)).toEqual([]);
      expect(getAllSubtasksFromPhases([])).toEqual([]);
    });

    it('flattens subtasks from all phases', () => {
      const phases = [
        makePhase('1', 'completed', [
          { name: 'subtask-a', status: 'done' },
          { name: 'subtask-b', status: 'done' },
        ]),
        makePhase('2', 'pending', [
          { name: 'subtask-c', status: 'open' },
        ]),
      ];
      const result = getAllSubtasksFromPhases(phases);
      expect(result).toHaveLength(3);
      expect(result.map((s) => s.name)).toEqual(['subtask-a', 'subtask-b', 'subtask-c']);
    });

    it('handles phases with no subtasks', () => {
      const phases = [makePhase('1', 'pending')];
      expect(getAllSubtasksFromPhases(phases)).toEqual([]);
    });
  });
});
