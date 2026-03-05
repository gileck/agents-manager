import { useEffect, useCallback } from 'react';
import type { Task, KanbanColumn } from '../../shared/types';
import { useKeyboardShortcutsConfig } from './useKeyboardShortcutsConfig';
import { matchesKeyEvent } from '../lib/keyboardShortcuts';

interface UseKanbanKeyboardShortcutsOptions {
  columns: KanbanColumn[];
  tasksByColumn: Map<string, Task[]>;
  onCardClick: (task: Task) => void;
  onCreateTask: () => void;
  enabled?: boolean;
}

/**
 * Custom hook to handle keyboard shortcuts for kanban board navigation
 *
 * Shortcuts:
 * - ArrowLeft/ArrowRight: Navigate between columns
 * - ArrowUp/ArrowDown: Navigate between cards in a column
 * - Enter: Open selected card
 * - n: Create new task
 * - Escape: Clear selection
 */
export function useKanbanKeyboardShortcuts({
  columns,
  tasksByColumn,
  onCardClick,
  onCreateTask,
  enabled = true,
}: UseKanbanKeyboardShortcutsOptions) {
  const { getCombo } = useKeyboardShortcutsConfig();

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Don't handle shortcuts if user is typing in an input
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    // Escape is non-customizable — always clears selection
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSelection();
      return;
    }

    // Get current selection from data attributes
    const selectedCard = document.querySelector('[data-kanban-selected="true"]');
    const selectedColumn = selectedCard?.closest('[data-kanban-column]');

    const sortedColumns = [...columns].sort((a, b) => a.order - b.order);

    if (matchesKeyEvent(getCombo('kanban.navLeft'), event)) {
      event.preventDefault();
      if (!selectedColumn) {
        selectFirstCard(sortedColumns, tasksByColumn);
      } else {
        const currentColumnId = selectedColumn.getAttribute('data-kanban-column');
        const currentIndex = sortedColumns.findIndex(col => col.id === currentColumnId);
        if (currentIndex > 0) {
          selectFirstCard(sortedColumns.slice(currentIndex - 1, currentIndex), tasksByColumn);
        }
      }
      return;
    }

    if (matchesKeyEvent(getCombo('kanban.navRight'), event)) {
      event.preventDefault();
      if (!selectedColumn) {
        selectFirstCard(sortedColumns, tasksByColumn);
      } else {
        const currentColumnId = selectedColumn.getAttribute('data-kanban-column');
        const currentIndex = sortedColumns.findIndex(col => col.id === currentColumnId);
        if (currentIndex < sortedColumns.length - 1) {
          selectFirstCard(sortedColumns.slice(currentIndex + 1, currentIndex + 2), tasksByColumn);
        }
      }
      return;
    }

    if (matchesKeyEvent(getCombo('kanban.navUp'), event)) {
      event.preventDefault();
      if (!selectedCard || !selectedColumn) {
        selectFirstCard(sortedColumns, tasksByColumn);
      } else {
        const columnId = selectedColumn.getAttribute('data-kanban-column');
        const tasks = columnId ? tasksByColumn.get(columnId) || [] : [];
        const currentTaskId = selectedCard.getAttribute('data-task-id');
        const currentIndex = tasks.findIndex(t => t.id === currentTaskId);
        if (currentIndex > 0) {
          selectCard(tasks[currentIndex - 1].id);
        }
      }
      return;
    }

    if (matchesKeyEvent(getCombo('kanban.navDown'), event)) {
      event.preventDefault();
      if (!selectedCard || !selectedColumn) {
        selectFirstCard(sortedColumns, tasksByColumn);
      } else {
        const columnId = selectedColumn.getAttribute('data-kanban-column');
        const tasks = columnId ? tasksByColumn.get(columnId) || [] : [];
        const currentTaskId = selectedCard.getAttribute('data-task-id');
        const currentIndex = tasks.findIndex(t => t.id === currentTaskId);
        if (currentIndex < tasks.length - 1) {
          selectCard(tasks[currentIndex + 1].id);
        }
      }
      return;
    }

    if (matchesKeyEvent(getCombo('kanban.openCard'), event)) {
      event.preventDefault();
      if (selectedCard) {
        const taskId = selectedCard.getAttribute('data-task-id');
        const columnId = selectedColumn?.getAttribute('data-kanban-column');
        if (taskId && columnId) {
          const tasks = tasksByColumn.get(columnId) || [];
          const task = tasks.find(t => t.id === taskId);
          if (task) {
            onCardClick(task);
          }
        }
      }
      return;
    }

    if (matchesKeyEvent(getCombo('kanban.newTask'), event)) {
      event.preventDefault();
      onCreateTask();
      return;
    }
  }, [enabled, columns, tasksByColumn, onCardClick, onCreateTask, getCombo]);

  useEffect(() => {
    if (enabled) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [enabled, handleKeyDown]);
}

// Helper functions
function selectCard(taskId: string) {
  // Clear previous selection
  clearSelection();

  // Set new selection
  const card = document.querySelector(`[data-task-id="${taskId}"]`);
  if (card) {
    card.setAttribute('data-kanban-selected', 'true');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function clearSelection() {
  const selected = document.querySelectorAll('[data-kanban-selected="true"]');
  selected.forEach(el => el.removeAttribute('data-kanban-selected'));
}

function selectFirstCard(columns: KanbanColumn[], tasksByColumn: Map<string, Task[]>) {
  for (const column of columns) {
    const tasks = tasksByColumn.get(column.id) || [];
    if (tasks.length > 0) {
      selectCard(tasks[0].id);
      break;
    }
  }
}
