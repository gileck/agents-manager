import { useState, useCallback, useEffect } from 'react';
import type { Task } from '../../shared/types';

interface UseKanbanMultiSelectOptions {
  tasks: Task[];
  enabled?: boolean;
}

export interface MultiSelectState {
  selectedTaskIds: Set<string>;
  isSelecting: boolean;
  lastSelectedId: string | null;
}

export interface MultiSelectActions {
  toggleTask: (taskId: string, event?: React.MouseEvent) => void;
  selectTask: (taskId: string) => void;
  deselectTask: (taskId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  selectRange: (fromId: string, toId: string) => void;
}

/**
 * Hook for managing multi-select state in kanban board
 * Supports Cmd/Ctrl+Click for individual selection and Shift+Click for range selection
 */
export function useKanbanMultiSelect({
  tasks,
  enabled = true,
}: UseKanbanMultiSelectOptions): [MultiSelectState, MultiSelectActions] {
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const isSelecting = selectedTaskIds.size > 0;

  // Clear selection when disabled
  useEffect(() => {
    if (!enabled && selectedTaskIds.size > 0) {
      setSelectedTaskIds(new Set());
      setLastSelectedId(null);
    }
  }, [enabled, selectedTaskIds.size]);

  const toggleTask = useCallback((taskId: string, event?: React.MouseEvent) => {
    if (!enabled) return;

    setSelectedTaskIds(prev => {
      const next = new Set(prev);

      // Handle Shift+Click for range selection
      if (event?.shiftKey && lastSelectedId) {
        const fromIndex = tasks.findIndex(t => t.id === lastSelectedId);
        const toIndex = tasks.findIndex(t => t.id === taskId);

        if (fromIndex !== -1 && toIndex !== -1) {
          const start = Math.min(fromIndex, toIndex);
          const end = Math.max(fromIndex, toIndex);

          for (let i = start; i <= end; i++) {
            next.add(tasks[i].id);
          }
        }
      }
      // Handle Cmd/Ctrl+Click for individual selection
      else if (event?.metaKey || event?.ctrlKey) {
        if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
        }
      }
      // Regular click without modifier - single selection
      else {
        next.clear();
        next.add(taskId);
      }

      return next;
    });

    setLastSelectedId(taskId);
  }, [enabled, tasks, lastSelectedId]);

  const selectTask = useCallback((taskId: string) => {
    if (!enabled) return;
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });
    setLastSelectedId(taskId);
  }, [enabled]);

  const deselectTask = useCallback((taskId: string) => {
    if (!enabled) return;
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }, [enabled]);

  const selectAll = useCallback(() => {
    if (!enabled) return;
    setSelectedTaskIds(new Set(tasks.map(t => t.id)));
  }, [enabled, tasks]);

  const clearSelection = useCallback(() => {
    setSelectedTaskIds(new Set());
    setLastSelectedId(null);
  }, []);

  const selectRange = useCallback((fromId: string, toId: string) => {
    if (!enabled) return;

    const fromIndex = tasks.findIndex(t => t.id === fromId);
    const toIndex = tasks.findIndex(t => t.id === toId);

    if (fromIndex !== -1 && toIndex !== -1) {
      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);

      const selected = new Set<string>();
      for (let i = start; i <= end; i++) {
        selected.add(tasks[i].id);
      }

      setSelectedTaskIds(selected);
      setLastSelectedId(toId);
    }
  }, [enabled, tasks]);

  // Keyboard shortcuts for multi-select
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd/Ctrl+A to select all
      if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
        const target = event.target as HTMLElement;
        // Only if not in an input field
        if (
          target.tagName !== 'INPUT' &&
          target.tagName !== 'TEXTAREA' &&
          !target.isContentEditable
        ) {
          event.preventDefault();
          selectAll();
        }
      }

      // Escape to clear selection
      if (event.key === 'Escape' && selectedTaskIds.size > 0) {
        event.preventDefault();
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, selectedTaskIds.size, selectAll, clearSelection]);

  return [
    { selectedTaskIds, isSelecting, lastSelectedId },
    { toggleTask, selectTask, deselectTask, selectAll, clearSelection, selectRange },
  ];
}
