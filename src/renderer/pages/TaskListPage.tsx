import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../components/ui/select';
import { useTasks } from '../hooks/useTasks';
import { usePipelines } from '../hooks/usePipelines';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { TaskFilterBar, EMPTY_FILTERS } from '../components/tasks/TaskFilterBar';
import { TaskSortControls } from '../components/tasks/TaskSortControls';
import { TaskStatusSummary } from '../components/tasks/TaskStatusSummary';
import { TaskEmptyState } from '../components/tasks/TaskEmptyState';
import { TaskGroupedList } from '../components/tasks/TaskGroupedList';
import { TaskCreateDialog } from '../components/tasks/TaskCreateDialog';
import { TaskDeleteDialog, BulkDeleteDialog } from '../components/tasks/TaskDeleteDialogs';
import { useFeatures } from '../hooks/useFeatures';
import { sortTasks, collectTags, collectDomains, buildPipelineMap, buildFeatureMap } from '../components/tasks/task-helpers';
import type { FilterState } from '../components/tasks/TaskFilterBar';
import type { SortField, SortDirection, GroupBy } from '../components/tasks/task-helpers';
import { toast } from 'sonner';
import type { Task, TaskFilter, TaskCreateInput, AppSettings } from '../../shared/types';

function useLocalStorage<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

export function TaskListPage() {
  const { currentProjectId, loading: projectLoading } = useCurrentProject();
  const navigate = useNavigate();

  // Persistent filters, sort & group state
  const [filters, setFilters] = useLocalStorage<FilterState>('taskList.filters', EMPTY_FILTERS);
  const [sortField, setSortField] = useLocalStorage<SortField>('taskList.sortField', 'created');
  const [sortDirection, setSortDirection] = useLocalStorage<SortDirection>('taskList.sortDirection', 'desc');
  const [groupBy, setGroupBy] = useLocalStorage<GroupBy>('taskList.groupBy', 'none');

  // Build backend filter from UI state
  const taskFilter: TaskFilter = {};
  if (currentProjectId) taskFilter.projectId = currentProjectId;
  if (filters.search) taskFilter.search = filters.search;
  if (filters.status) taskFilter.status = filters.status;
  if (filters.assignee) taskFilter.assignee = filters.assignee;
  if (filters.priority) taskFilter.priority = Number(filters.priority);
  if (filters.pipelineId) taskFilter.pipelineId = filters.pipelineId;
  if (filters.tag) taskFilter.tag = filters.tag;
  if (filters.domain) taskFilter.domain = filters.domain;

  if (filters.featureId) {
    if (filters.featureId === '__none__') {
      taskFilter.featureId = null;
    } else {
      taskFilter.featureId = filters.featureId;
    }
  }

  const { tasks, loading, error, refetch } = useTasks(taskFilter);
  const { pipelines } = usePipelines();
  const { features } = useFeatures(currentProjectId ? { projectId: currentProjectId } : undefined);

  // Derived data
  const pipelineMap = useMemo(() => buildPipelineMap(pipelines), [pipelines]);
  const featureMap = useMemo(() => buildFeatureMap(features), [features]);
  const availableTags = useMemo(() => collectTags(tasks), [tasks]);
  const availableDomains = useMemo(() => collectDomains(tasks), [tasks]);
  const sortedTasks = useMemo(() => sortTasks(tasks, sortField, sortDirection), [tasks, sortField, sortDirection]);
  const allStatuses = useMemo(
    () => pipelines.flatMap((p) => p.statuses).reduce<string[]>((acc, s) => {
      if (!acc.includes(s.name)) acc.push(s.name);
      return acc;
    }, []),
    [pipelines],
  );

  // Active agents
  const [activeTaskIds, setActiveTaskIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let mounted = true;
    const fetchActive = () => {
      window.api.agents.activeTaskIds().then((ids: string[]) => {
        if (mounted) setActiveTaskIds(new Set(ids));
      }).catch(() => {});
    };
    fetchActive();
    const interval = setInterval(fetchActive, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Create dialog
  const [defaultPipelineId, setDefaultPipelineId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Omit<TaskCreateInput, 'projectId'>>({ pipelineId: '', title: '', description: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    window.api.settings.get().then((s: AppSettings) => setDefaultPipelineId(s.defaultPipelineId));
  }, []);

  const openCreateDialog = () => {
    const prefill = (defaultPipelineId && pipelines.some((p) => p.id === defaultPipelineId))
      ? defaultPipelineId : '';
    setForm({ pipelineId: prefill, title: '', description: '' });
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!form.title.trim() || !currentProjectId || !form.pipelineId) return;
    setCreating(true);
    try {
      const task = await window.api.tasks.create({ ...form, projectId: currentProjectId });
      setDialogOpen(false);
      setForm({ pipelineId: '', title: '', description: '' });
      await refetch();
      navigate(`/tasks/${task.id}`);
    } finally {
      setCreating(false);
    }
  };

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await window.api.tasks.delete(deleteTarget.id);
      setDeleteTarget(null);
      const next = new Set(selectedIds);
      next.delete(deleteTarget.id);
      setSelectedIds(next);
      await refetch();
    } finally {
      setDeleting(false);
    }
  };

  // Selection
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const allSelected = tasks.length > 0 && selectedIds.size === tasks.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < tasks.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(tasks.map((t) => t.id)));
  };
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      for (const id of selectedIds) await window.api.tasks.delete(id);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      setSelectMode(false);
      await refetch();
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDuplicate = async (task: Task) => {
    const newTask = await window.api.tasks.create({
      projectId: task.projectId,
      pipelineId: task.pipelineId,
      title: `${task.title} (copy)`,
      description: task.description ?? undefined,
      priority: task.priority,
      assignee: task.assignee ?? undefined,
      domain: task.domain ?? undefined,
      tags: task.tags,
    });
    navigate(`/tasks/${newTask.id}`);
  };

  // Status change
  const handleStatusChange = async (taskId: string, toStatus: string) => {
    try {
      const result = await window.api.tasks.transition(taskId, toStatus);
      if (result.success) {
        toast.success(`Status changed to "${toStatus}"`);
        await refetch();
      } else if (result.guardFailures && result.guardFailures.length > 0) {
        const reasons = result.guardFailures.map((g) => g.reason).join('; ');
        toast.error('Transition blocked', { description: reasons });
      } else {
        toast.error('Transition failed', { description: result.error ?? 'Unknown error' });
      }
    } catch (err) {
      toast.error('Transition failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  // Loading / error / no project states
  if (projectLoading || loading) {
    return <div className="p-8"><p className="text-muted-foreground">Loading tasks...</p></div>;
  }
  if (error) {
    return <div className="p-8"><p className="text-destructive">Error: {error}</p></div>;
  }
  if (!currentProjectId) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-4">Tasks</h1>
        <Card><CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No project selected. Go to Projects to select one.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold">Tasks</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
            <span>Group:</span>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="pipeline">Pipeline</SelectItem>
                <SelectItem value="feature">Feature</SelectItem>
                <SelectItem value="domain">Domain</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
            <span>Sort:</span>
            <TaskSortControls
              sortField={sortField}
              sortDirection={sortDirection}
              onSortFieldChange={setSortField}
              onSortDirectionToggle={() => setSortDirection((d) => d === 'asc' ? 'desc' : 'asc')}
            />
          </div>
          {tasks.length > 0 && (
            <Button
              variant={selectMode ? 'outline' : 'secondary'}
              size="sm"
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </Button>
          )}
          <Button size="sm" onClick={openCreateDialog}>New Task</Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-4">
        <TaskFilterBar
          filters={filters}
          onFiltersChange={setFilters}
          statuses={allStatuses}
          pipelines={pipelines}
          tags={availableTags}
          features={features}
          domains={availableDomains}
        />
      </div>

      {/* Status summary */}
      <div className="mb-4">
        <TaskStatusSummary tasks={sortedTasks} pipelineMap={pipelineMap} />
      </div>

      {/* Task list */}
      {sortedTasks.length === 0 ? (
        <TaskEmptyState
          hasFilters={hasActiveFilters}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
          onCreateTask={openCreateDialog}
        />
      ) : (
        <>
          {selectMode && (
            <div className="flex items-center gap-3 px-4 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
              />
              <span className="text-sm text-muted-foreground">
                {selectedIds.size > 0 ? `${selectedIds.size} of ${tasks.length} selected` : 'Select all'}
              </span>
              {selectedIds.size > 0 && (
                <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                  Delete selected ({selectedIds.size})
                </Button>
              )}
            </div>
          )}

          <TaskGroupedList
            tasks={sortedTasks}
            groupBy={groupBy}
            pipelineMap={pipelineMap}
            featureMap={featureMap}
            activeTaskIds={activeTaskIds}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onClickTask={(id) => navigate(`/tasks/${id}`)}
            onDeleteTask={setDeleteTarget}
            onDuplicateTask={handleDuplicate}
            onStatusChange={handleStatusChange}
          />
        </>
      )}

      {/* Dialogs */}
      <TaskCreateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        pipelines={pipelines}
        features={features}
        form={form}
        onFormChange={setForm}
        onCreate={handleCreate}
        creating={creating}
      />
      <TaskDeleteDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        deleting={deleting}
      />
      <BulkDeleteDialog
        open={bulkDeleteOpen}
        count={selectedIds.size}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        deleting={bulkDeleting}
      />
    </div>
  );
}
