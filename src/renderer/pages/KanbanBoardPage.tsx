import React, { useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Button } from '../components/ui/button';
import { Plus } from 'lucide-react';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useKanbanBoard } from '../hooks/useKanbanBoard';
import { useTasks } from '../hooks/useTasks';
import { usePipelines } from '../hooks/usePipelines';
import { KanbanColumn } from '../components/kanban/KanbanColumn';
import { KanbanDragOverlay } from '../components/kanban/KanbanDragOverlay';
import { useKanbanDragDrop } from '../hooks/useKanbanDragDrop';
import { toast } from 'sonner';
import type { Task, KanbanColumn as KanbanColumnType, KanbanBoardCreateInput, TransitionResult } from '../../shared/types';

export function KanbanBoardPage() {
  const { currentProjectId, loading: projectLoading } = useCurrentProject();
  const navigate = useNavigate();
  const { board, loading: boardLoading, refetch: refetchBoard } = useKanbanBoard(currentProjectId);
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useTasks(currentProjectId ? { projectId: currentProjectId } : undefined);
  const { pipelines } = usePipelines();

  // Setup drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Handle task move with transition
  const handleTaskMove = useCallback(async (taskId: string, newStatus: string): Promise<TransitionResult> => {
    const result = await window.api.tasks.transition(taskId, newStatus, 'manual');

    // Refetch tasks to get updated state
    await refetchTasks();

    return result;
  }, [refetchTasks]);

  // Setup drag and drop handlers
  const { activeTask, handleDragStart, handleDragEnd, handleDragCancel } = useKanbanDragDrop({
    tasks,
    columns: board?.columns || [],
    onTaskMove: handleTaskMove,
  });

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

  // Group tasks by column
  const tasksByColumn = useMemo(() => {
    if (!board) return new Map<string, Task[]>();

    const map = new Map<string, Task[]>();

    // Initialize all columns with empty arrays
    board.columns.forEach(column => {
      map.set(column.id, []);
    });

    // Distribute tasks to columns based on status mapping
    tasks.forEach(task => {
      const column = board.columns.find(col => col.statuses.includes(task.status));
      if (column) {
        const columnTasks = map.get(column.id) || [];
        columnTasks.push(task);
        map.set(column.id, columnTasks);
      }
    });

    return map;
  }, [board, tasks]);

  const handleCardClick = (task: Task) => {
    navigate(`/tasks/${task.id}`);
  };

  const handleCreateTask = () => {
    navigate('/tasks?action=create');
  };

  const loading = projectLoading || boardLoading || tasksLoading;

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

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h1 className="text-2xl font-bold">{board.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
            </p>
          </div>
          <Button onClick={handleCreateTask}>
            <Plus className="w-4 h-4 mr-2" />
            New Task
          </Button>
        </div>

        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-4 h-full">
            {board.columns
              .sort((a, b) => a.order - b.order)
              .map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  tasks={tasksByColumn.get(column.id) || []}
                  onCardClick={handleCardClick}
                />
              ))}
          </div>
        </div>
      </div>

      <KanbanDragOverlay activeTask={activeTask} />
    </DndContext>
  );
}
