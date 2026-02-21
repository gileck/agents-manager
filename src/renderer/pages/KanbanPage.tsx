import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Layers, Plus } from 'lucide-react';
import { usePipelines } from '../hooks/usePipelines';
import { useTasks } from '../hooks/useTasks';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { TaskCreateDialog } from '../components/tasks/TaskCreateDialog';
import { TaskFilterBar, EMPTY_FILTERS } from '../components/tasks/TaskFilterBar';
import { KanbanBoard } from '../components/kanban/KanbanBoard';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { buildPipelineMap, collectTags } from '../components/tasks/task-helpers';
import { useFeatures } from '../hooks/useFeatures';
import { toast } from 'sonner';
import type { FilterState } from '../components/tasks/TaskFilterBar';
import type { Pipeline, TaskFilter, TaskCreateInput } from '../../shared/types';

export type PipelineMap = Map<string, Pipeline>;

export function KanbanPage() {
  const navigate = useNavigate();
  const { currentProjectId, loading: projectLoading } = useCurrentProject();
  const { pipelines, loading: pipelinesLoading } = usePipelines();

  // Persistent state
  const [selectedPipelineId, setSelectedPipelineId] = useLocalStorage<string | null>(
    'kanban.selectedPipeline',
    null
  );
  const [filters, setFilters] = useLocalStorage<FilterState>('kanban.filters', EMPTY_FILTERS);
  const [collapsedColumns, setCollapsedColumns] = useLocalStorage<string[]>(
    'kanban.collapsedColumns',
    []
  );
  const [sortBy, setSortBy] = useLocalStorage<'priority' | 'created' | 'updated' | 'title'>(
    'kanban.sortBy',
    'priority'
  );
  const [sortDirection, setSortDirection] = useLocalStorage<'asc' | 'desc'>(
    'kanban.sortDirection',
    'asc'
  );

  // State
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Omit<TaskCreateInput, 'projectId'>>({
    pipelineId: selectedPipelineId || '',
    title: '',
    description: ''
  });
  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId) || null;

  // Get features for the create dialog
  const { features } = useFeatures(currentProjectId ? { projectId: currentProjectId } : undefined);

  // Build task filter
  const taskFilter: TaskFilter = {
    ...(currentProjectId ? { projectId: currentProjectId } : {}),
    ...(selectedPipelineId ? { pipeline: selectedPipelineId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: parseInt(filters.priority) } : {}),
    ...(filters.assignee ? { assignee: filters.assignee } : {}),
    ...(filters.tag ? { tags: [filters.tag] } : {}),
    ...(filters.featureId ? { feature: filters.featureId } : {}),
    ...(filters.search ? { search: filters.search } : {}),
  };

  const { tasks, loading: tasksLoading, error, refetch } = useTasks(taskFilter);
  const pipelineMap = buildPipelineMap(pipelines);

  // Compute available tags and statuses
  const availableTags = React.useMemo(() => collectTags(tasks), [tasks]);
  const allStatuses = React.useMemo(
    () => pipelines.flatMap((p) => p.statuses).reduce<string[]>((acc, s) => {
      if (!acc.includes(s.name)) acc.push(s.name);
      return acc;
    }, []),
    [pipelines]
  );

  // Auto-select first pipeline if none selected
  useEffect(() => {
    if (!selectedPipelineId && pipelines.length > 0 && !pipelinesLoading) {
      setSelectedPipelineId(pipelines[0].id);
    }
  }, [pipelines, selectedPipelineId, pipelinesLoading, setSelectedPipelineId]);

  // Redirect if no project selected
  useEffect(() => {
    if (!projectLoading && !currentProjectId) {
      navigate('/projects');
    }
  }, [currentProjectId, projectLoading, navigate]);

  if (projectLoading || pipelinesLoading) {
    return (
      <div className="flex-1 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-muted rounded w-1/4" />
          <div className="h-96 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!currentProjectId) {
    return null;
  }

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      await window.api.tasks.transition(taskId, newStatus);
      toast.success('Task status updated');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update task status');
    }
  };

  const handleTaskCreate = async () => {
    if (!currentProjectId) return;

    setCreating(true);
    try {
      await window.api.tasks.create({
        ...form,
        projectId: currentProjectId,
      });
      toast.success('Task created');
      setForm({
        pipelineId: selectedPipelineId || '',
        title: '',
        description: ''
      });
      setCreateDialogOpen(false);
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const toggleColumnCollapse = (columnId: string) => {
    setCollapsedColumns(prev =>
      prev.includes(columnId)
        ? prev.filter(id => id !== columnId)
        : [...prev, columnId]
    );
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="p-6 pb-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="h-6 w-6" />
              Kanban Board
            </h1>

            {/* Pipeline Selector */}
            <Select
              value={selectedPipelineId || ''}
              onValueChange={setSelectedPipelineId}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select Pipeline" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={() => {
            setForm({
              pipelineId: selectedPipelineId || '',
              title: '',
              description: ''
            });
            setCreateDialogOpen(true);
          }}>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>

        {/* Filters */}
        <TaskFilterBar
          filters={filters}
          onFiltersChange={setFilters}
          statuses={allStatuses}
          pipelines={pipelines}
          tags={availableTags}
          features={features}
        />
      </div>

      {/* Board Content */}
      <div className="flex-1 overflow-auto bg-muted/30">
        {selectedPipeline ? (
          <KanbanBoard
            tasks={tasks}
            pipeline={selectedPipeline}
            pipelineMap={pipelineMap}
            loading={tasksLoading}
            error={error ? new Error(error) : null}
            collapsedColumns={collapsedColumns}
            onToggleColumnCollapse={toggleColumnCollapse}
            onStatusChange={handleStatusChange}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={(field, direction) => {
              setSortBy(field);
              setSortDirection(direction);
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No Pipeline Selected</h3>
              <p className="text-muted-foreground">
                Select a pipeline from the dropdown to view its Kanban board
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <TaskCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        pipelines={pipelines}
        features={features}
        form={form}
        onFormChange={setForm}
        onCreate={handleTaskCreate}
        creating={creating}
      />
    </div>
  );
}