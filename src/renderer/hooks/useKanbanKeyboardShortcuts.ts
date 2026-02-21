import { useEffect, useCallback } from 'react';
import type { Task, KanbanColumn } from '../../shared/types';

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

    // Get current selection from data attributes
    const selectedCard = document.querySelector('[data-kanban-selected="true"]');
    const selectedColumn = selectedCard?.closest('[data-kanban-column]');

    const sortedColumns = [...columns].sort((a, b) => a.order - b.order);

    switch (event.key) {
      case 'ArrowLeft': {
        event.preventDefault();
        if (!selectedColumn) {
          // Select first card in first column
          selectFirstCard(sortedColumns, tasksByColumn);
        } else {
          // Move to previous column
          const currentColumnId = selectedColumn.getAttribute('data-kanban-column');
          const currentIndex = sortedColumns.findIndex(col => col.id === currentColumnId);
          if (currentIndex > 0) {
            selectFirstCard(sortedColumns.slice(currentIndex - 1, currentIndex), tasksByColumn);
          }
        }
        break;
      }

      case 'ArrowRight': {
        event.preventDefault();
        if (!selectedColumn) {
          // Select first card in first column
          selectFirstCard(sortedColumns, tasksByColumn);
        } else {
          // Move to next column
          const currentColumnId = selectedColumn.getAttribute('data-kanban-column');
          const currentIndex = sortedColumns.findIndex(col => col.id === currentColumnId);
          if (currentIndex < sortedColumns.length - 1) {
            selectFirstCard(sortedColumns.slice(currentIndex + 1, currentIndex + 2), tasksByColumn);
          }
        }
        break;
      }

      case 'ArrowUp': {
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
        break;
      }

      case 'ArrowDown': {
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
        break;
      }

      case 'Enter': {
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
        break;
      }

      case 'n':
      case 'N': {
        // Only trigger if not in an input field
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          onCreateTask();
        }
        break;
      }

      case 'Escape': {
        event.preventDefault();
        clearSelection();
        break;
      }
    }
  }, [enabled, columns, tasksByColumn, onCardClick, onCreateTask]);

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
