import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Button } from '../components/ui/button';
import { Plus, ChevronsRight } from 'lucide-react';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useKanbanBoard } from '../hooks/useKanbanBoard';
import { useTasks } from '../hooks/useTasks';
import { usePipelines } from '../hooks/usePipelines';
import { VirtualizedKanbanColumn } from '../components/kanban/VirtualizedKanbanColumn';
import { KanbanDragOverlay } from '../components/kanban/KanbanDragOverlay';
import { KanbanFilters } from '../components/kanban/KanbanFilters';
import { KanbanBoardConfigDialog } from '../components/kanban/KanbanBoardConfig';
import { KanbanEmptyState } from '../components/kanban/KanbanEmptyState';
import { KanbanBulkActions } from '../components/kanban/KanbanBulkActions';
import { KanbanTaskDialog } from '../components/kanban/KanbanTaskDialog';
import { useKanbanDragDrop } from '../hooks/useKanbanDragDrop';
import { useKanbanKeyboardShortcuts } from '../hooks/useKanbanKeyboardShortcuts';
import { useKanbanMultiSelect } from '../hooks/useKanbanMultiSelect';
import { applyKanbanFilters, sortKanbanTasks, extractFilterOptions, hasActiveFilters, createEmptyFilters } from '../utils/kanban-filters';
import { toast } from 'sonner';
import { reportError } from '../lib/error-handler';
import { getColumnColor, rgba } from '../utils/kanban-colors';
import type { Task, KanbanColumn as KanbanColumnType, KanbanBoardCreateInput, KanbanBoardUpdateInput, KanbanFilters as KanbanFiltersType, TransitionResult } from '../../shared/types';

export function KanbanBoardPage() {
  const { currentProjectId, loading: projectLoading } = useCurrentProject();
  const navigate = useNavigate();
  const { board, loading: boardLoading, refetch: refetchBoard } = useKanbanBoard(currentProjectId);
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useTasks(currentProjectId ? { projectId: currentProjectId } : undefined);
  const { pipelines } = usePipelines();

  // Local filters state (initialized from board config)
  const [localFilters, setLocalFilters] = useState<KanbanFiltersType>(createEmptyFilters());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [hideEmptyColumns, setHideEmptyColumns] = useState(true);

  // Setup drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Initialize filters from board config
  useEffect(() => {
    if (board) {
      setLocalFilters(board.filters || createEmptyFilters());
    }
  }, [board]);

  // Handle task move with transition
  const handleTaskMove = useCallback(async (taskId: string, newStatus: string): Promise<TransitionResult> => {
    const result = await window.api.tasks.transition(taskId, newStatus, 'admin');

    // Refetch tasks to get updated state
    await refetchTasks();

    return result;
  }, [refetchTasks]);

  // Handle board configuration update
  const handleBoardUpdate = useCallback(async (input: KanbanBoardUpdateInput) => {
    if (!board) return;

    try {
      await window.api.kanbanBoards.update(board.id, input);
      await refetchBoard();
      toast.success('Board settings updated');
    } catch (error) {
      reportError(error, 'Board settings update');
    }
  }, [board, refetchBoard]);

  // Handle filter changes with persistence
  const handleFiltersChange = useCallback(async (newFilters: KanbanFiltersType) => {
    setLocalFilters(newFilters);

    // Persist filters to board config
    if (board) {
      try {
        await window.api.kanbanBoards.update(board.id, { filters: newFilters });
      } catch (error) {
        console.error('Failed to persist filters:', error);
      }
    }
  }, [board]);

  const handleClearFilters = useCallback(() => {
    handleFiltersChange(createEmptyFilters());
  }, [handleFiltersChange]);

  // Toggle column collapse state
  const handleToggleCollapse = useCallback(async (columnId: string) => {
    if (!board) return;

    const updatedColumns = board.columns.map(col =>
      col.id === columnId ? { ...col, collapsed: !col.collapsed } : col
    );

    try {
      await window.api.kanbanBoards.update(board.id, { columns: updatedColumns });
      await refetchBoard();
    } catch (error) {
      console.error('Failed to toggle column collapse:', error);
    }
  }, [board, refetchBoard]);

  // Expand all columns
  const handleExpandAll = useCallback(async () => {
    if (!board) return;

    const updatedColumns = board.columns.map(col => ({ ...col, collapsed: false }));

    try {
      await window.api.kanbanBoards.update(board.id, { columns: updatedColumns });
      await refetchBoard();
    } catch (error) {
      console.error('Failed to expand columns:', error);
    }
  }, [board, refetchBoard]);

  // Define loading early
  const loading = projectLoading || boardLoading || tasksLoading;

  // Initialize board if it doesn't exist
  useEffect(() => {
    async function initializeBoard() {
      if (!currentProjectId || boardLoading || projectLoading) return;

      if (!board) {
        // Create a default board with columns from the first pipeline
        const firstPipeline = pipelines.find(p => p.taskType === 'agent') ?? pipelines[0];
        if (!firstPipeline) return;

        const defaultColumns: KanbanColumnType[] = firstPipeline.statuses.map((status, index) => ({
          id: `col-${status.name}`,
          title: status.label,
          statuses: [status.name],
          collapsed: false,
          order: index,
        }));

        try {
          const input: KanbanBoardCreateInput = {
            projectId: currentProjectId,
            name: 'Default Board',
            columns: defaultColumns,
          };
          await window.api.kanbanBoards.create(input);
          await refetchBoard();
        } catch (error) {
          reportError(error, 'Kanban board creation');
        }
      }
    }

    initializeBoard();
  }, [currentProjectId, board, boardLoading, projectLoading, pipelines, refetchBoard]);

  // Apply filters and sorting to tasks
  const filteredAndSortedTasks = useMemo(() => {
    // Apply filters
    let filtered = applyKanbanFilters(tasks, localFilters);

    // Apply sorting
    if (board) {
      filtered = sortKanbanTasks(filtered, board.sortBy, board.sortDirection);
    }

    return filtered;
  }, [tasks, localFilters, board]);

  // Multi-select state
  const [multiSelectState, multiSelectActions] = useKanbanMultiSelect({
    tasks: filteredAndSortedTasks,
    enabled: !loading,
  });

  // Group tasks by column
  const tasksByColumn = useMemo(() => {
    if (!board) return new Map<string, Task[]>();

    const map = new Map<string, Task[]>();

    // Initialize all columns with empty arrays
    board.columns.forEach(column => {
      map.set(column.id, []);
    });

    // Distribute filtered tasks to columns based on status mapping
    filteredAndSortedTasks.forEach(task => {
      const column = board.columns.find(col => col.statuses.includes(task.status));
      if (column) {
        const columnTasks = map.get(column.id) || [];
        columnTasks.push(task);
        map.set(column.id, columnTasks);
      }
    });

    return map;
  }, [board, filteredAndSortedTasks]);

  // Extract filter options from all tasks
  const filterOptions = useMemo(() => extractFilterOptions(tasks), [tasks]);

  // Setup drag and drop handlers (use filtered tasks for drag validation)
  const { activeTask, handleDragStart, handleDragEnd, handleDragCancel } = useKanbanDragDrop({
    tasks: filteredAndSortedTasks,
    columns: board?.columns || [],
    onTaskMove: handleTaskMove,
  });

  const handleCardClick = useCallback((task: Task, event: React.MouseEvent) => {
    // Handle multi-select if modifier keys are pressed
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      multiSelectActions.toggleTask(task.id, event);
    } else if (multiSelectState.isSelecting) {
      // If multi-selecting, clicking without modifier clears and opens
      multiSelectActions.clearSelection();
      setSelectedTask(task);
    } else {
      // Normal click - open quick-view dialog
      setSelectedTask(task);
    }
  }, [multiSelectState.isSelecting, multiSelectActions]);

  const handleCreateTask = useCallback(() => {
    navigate('/tasks?action=create');
  }, [navigate]);

  // Setup keyboard shortcuts (wrapper for keyboard navigation)
  const handleKeyboardCardClick = useCallback((task: Task) => {
    setSelectedTask(task);
  }, []);

  useKanbanKeyboardShortcuts({
    columns: board?.columns || [],
    tasksByColumn,
    onCardClick: handleKeyboardCardClick,
    onCreateTask: handleCreateTask,
    enabled: !loading && !!board,
  });

  // Bulk operations handlers
  const handleBulkDelete = useCallback(async () => {
    const count = multiSelectState.selectedTaskIds.size;
    if (count === 0) return;

    if (!confirm(`Delete ${count} selected ${count === 1 ? 'task' : 'tasks'}? This cannot be undone.`)) {
      return;
    }

    try {
      const deletePromises = Array.from(multiSelectState.selectedTaskIds).map(taskId =>
        window.api.tasks.delete(taskId)
      );
      await Promise.all(deletePromises);

      multiSelectActions.clearSelection();
      await refetchTasks();
      toast.success(`Deleted ${count} ${count === 1 ? 'task' : 'tasks'}`);
    } catch (error) {
      reportError(error, 'Task deletion');
    }
  }, [multiSelectState.selectedTaskIds, multiSelectActions, refetchTasks]);

  if (!currentProjectId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>No project selected</p>
          <p className="text-sm mt-2">Select a project to view the kanban board</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>No kanban board found</p>
          <p className="text-sm mt-2">Initializing...</p>
        </div>
      </div>
    );
  }

  const hasFilters = hasActiveFilters(localFilters);
  const showEmptyState = filteredAndSortedTasks.length === 0;

  // Determine visible columns
  const visibleColumns = board.columns
    .sort((a, b) => a.order - b.order)
    .map((column, originalIndex) => ({ column, originalIndex, tasks: tasksByColumn.get(column.id) || [] }))
    .filter(({ column, tasks: colTasks }) => {
      // Always show collapsed columns (they take minimal space)
      if (column.collapsed) return true;
      return !hideEmptyColumns || colTasks.length > 0;
    });

  // Check if all visible columns are collapsed
  const allCollapsed = visibleColumns.length > 0 && visibleColumns.every(({ column }) => column.collapsed);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ background: `linear-gradient(to right, ${rgba('#3b82f6', 0.02)}, ${rgba('#8b5cf6', 0.02)})` }}
        >
          <div>
            <h1 className="text-xl font-bold">{board.name}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filteredAndSortedTasks.length} {filteredAndSortedTasks.length === 1 ? 'task' : 'tasks'}
              {hasFilters && ` (${tasks.length} total)`}
            </p>
          </div>
          <div className="flex gap-2">
            <KanbanBoardConfigDialog board={board} onUpdate={handleBoardUpdate} />
            <Button
              size="sm"
              onClick={handleCreateTask}
              style={{ background: 'linear-gradient(to right, #2563eb, #7c3aed)', color: '#fff', border: 'none', boxShadow: '0 2px 4px -1px rgba(37, 99, 235, 0.2)' }}
            >
              <Plus className="w-4 h-4 mr-1" />
              New Task
            </Button>
          </div>
        </div>

        {/* Filters — compact single-row bar */}
        <div className="px-3 py-2 border-b" style={{ backgroundColor: rgba('#6b7280', 0.03) }}>
          <KanbanFilters
            filters={localFilters}
            onFiltersChange={handleFiltersChange}
            availableTags={filterOptions.tags}
            availableAssignees={filterOptions.assignees}
            onClearFilters={handleClearFilters}
            hideEmptyColumns={hideEmptyColumns}
            onHideEmptyColumnsChange={setHideEmptyColumns}
          />
        </div>

        {/* Board Content */}
        {showEmptyState ? (
          <div className="flex-1">
            <KanbanEmptyState
              variant={hasFilters ? 'filtered' : 'board'}
              onAction={hasFilters ? handleClearFilters : handleCreateTask}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto p-3">
            <div className="flex gap-3 h-full">
              {visibleColumns.map(({ column, originalIndex, tasks: colTasks }) => (
                <VirtualizedKanbanColumn
                  key={column.id}
                  column={column}
                  tasks={colTasks}
                  onCardClick={handleCardClick}
                  selectedTaskIds={multiSelectState.selectedTaskIds}
                  colorTheme={getColumnColor(originalIndex)}
                  onToggleCollapse={() => handleToggleCollapse(column.id)}
                />
              ))}
            </div>

            {/* All-collapsed hint */}
            {allCollapsed && (
              <div className="flex items-center justify-center mt-8">
                <Button variant="outline" size="sm" onClick={handleExpandAll} className="gap-2">
                  <ChevronsRight className="w-4 h-4" />
                  Expand all columns
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bulk Actions Toolbar */}
      <KanbanBulkActions
        selectedCount={multiSelectState.selectedTaskIds.size}
        onClearSelection={multiSelectActions.clearSelection}
        onBulkDelete={handleBulkDelete}
      />

      <KanbanDragOverlay activeTask={activeTask} />

      {/* Task Quick-View Dialog */}
      <KanbanTaskDialog task={selectedTask} onClose={() => setSelectedTask(null)} onTaskMoved={refetchTasks} />
    </DndContext>
  );
}
