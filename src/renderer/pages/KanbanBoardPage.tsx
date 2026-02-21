import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Button } from '../components/ui/button';
import { Plus } from 'lucide-react';
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
import { useKanbanDragDrop } from '../hooks/useKanbanDragDrop';
import { useKanbanKeyboardShortcuts } from '../hooks/useKanbanKeyboardShortcuts';
import { useKanbanMultiSelect } from '../hooks/useKanbanMultiSelect';
import { applyKanbanFilters, sortKanbanTasks, extractFilterOptions, hasActiveFilters, createEmptyFilters } from '../utils/kanban-filters';
import { toast } from 'sonner';
import type { Task, KanbanColumn as KanbanColumnType, KanbanBoardCreateInput, KanbanBoardUpdateInput, KanbanFilters as KanbanFiltersType, TransitionResult } from '../../shared/types';

export function KanbanBoardPage() {
  const { currentProjectId, loading: projectLoading } = useCurrentProject();
  const navigate = useNavigate();
  const { board, loading: boardLoading, refetch: refetchBoard } = useKanbanBoard(currentProjectId);
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useTasks(currentProjectId ? { projectId: currentProjectId } : undefined);
  const { pipelines } = usePipelines();

  // Local filters state (initialized from board config)
  const [localFilters, setLocalFilters] = useState<KanbanFiltersType>(createEmptyFilters());

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
    const result = await window.api.tasks.transition(taskId, newStatus, 'manual');

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
      toast.error('Failed to update board settings');
      console.error(error);
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

  // Define loading early
  const loading = projectLoading || boardLoading || tasksLoading;

  // Initialize board if it doesn't exist
  useEffect(() => {
    async function initializeBoard() {
      if (!currentProjectId || boardLoading || projectLoading) return;

      if (!board) {
        // Create a default board with columns from the first pipeline
        const firstPipeline = pipelines.find(p => p.taskType === 'task');
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
          toast.error('Failed to create kanban board');
          console.error(error);
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
      navigate(`/tasks/${task.id}`);
    } else {
      // Normal click - open task
      navigate(`/tasks/${task.id}`);
    }
  }, [navigate, multiSelectState.isSelecting, multiSelectActions]);

  const handleCreateTask = useCallback(() => {
    navigate('/tasks?action=create');
  }, [navigate]);

  // Setup keyboard shortcuts (wrapper for keyboard navigation)
  const handleKeyboardCardClick = useCallback((task: Task) => {
    navigate(`/tasks/${task.id}`);
  }, [navigate]);

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
      toast.error('Failed to delete tasks');
      console.error(error);
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

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h1 className="text-2xl font-bold">{board.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {filteredAndSortedTasks.length} {filteredAndSortedTasks.length === 1 ? 'task' : 'tasks'}
              {hasFilters && ` (${tasks.length} total)`}
            </p>
          </div>
          <div className="flex gap-2">
            <KanbanBoardConfigDialog board={board} onUpdate={handleBoardUpdate} />
            <Button onClick={handleCreateTask}>
              <Plus className="w-4 h-4 mr-2" />
              New Task
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b bg-muted/30">
          <KanbanFilters
            filters={localFilters}
            onFiltersChange={handleFiltersChange}
            availableTags={filterOptions.tags}
            availableAssignees={filterOptions.assignees}
            onClearFilters={handleClearFilters}
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
          <div className="flex-1 overflow-x-auto p-4">
            <div className="flex gap-4 h-full">
              {board.columns
                .sort((a, b) => a.order - b.order)
                .map((column) => (
                  <VirtualizedKanbanColumn
                    key={column.id}
                    column={column}
                    tasks={tasksByColumn.get(column.id) || []}
                    onCardClick={handleCardClick}
                    selectedTaskIds={multiSelectState.selectedTaskIds}
                  />
                ))}
            </div>
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
    </DndContext>
  );
}
