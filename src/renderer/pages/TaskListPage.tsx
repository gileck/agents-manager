import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { InlineError } from '../components/InlineError';
import { useTasks } from '../hooks/useTasks';
import { usePipelines } from '../hooks/usePipelines';
import { reportError } from '../lib/error-handler';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { EMPTY_FILTERS } from '../components/tasks/TaskFilterBar';
import { TaskStatusSummary } from '../components/tasks/TaskStatusSummary';
import { TaskEmptyState } from '../components/tasks/TaskEmptyState';
import { TaskGroupedList } from '../components/tasks/TaskGroupedList';
import { TaskCreateDialog } from '../components/tasks/TaskCreateDialog';
import { TaskDeleteDialog, BulkDeleteDialog } from '../components/tasks/TaskDeleteDialogs';
import { TaskToolbar } from '../components/tasks/TaskToolbar';
import { TaskFilterPanel } from '../components/tasks/TaskFilterPanel';
import { TaskBulkActionBar } from '../components/tasks/TaskBulkActionBar';
import { useFeatures } from '../hooks/useFeatures';
import { sortTasks, collectTags, buildPipelineMap, buildFeatureMap } from '../components/tasks/task-helpers';
import type { FilterState } from '../components/tasks/TaskFilterBar';
import type { SortField, SortDirection, GroupBy, ViewMode } from '../components/tasks/task-helpers';
import { toast } from 'sonner';
import type { Task, TaskFilter, TaskCreateInput, AppSettings, TaskCreatedBy } from '../../shared/types';
import { useLocalStorage } from '../hooks/useLocalStorage';

export function TaskListPage() {
  const { currentProjectId, loading: projectLoading } = useCurrentProject();
  const navigate = useNavigate();

  // Persistent filters, sort, group & view state
  const [filters, setFilters] = useLocalStorage<FilterState>('taskList.filters', EMPTY_FILTERS);
  const [sortField, setSortField] = useLocalStorage<SortField>('taskList.sortField', 'created');
  const [sortDirection, setSortDirection] = useLocalStorage<SortDirection>('taskList.sortDirection', 'desc');
  const [groupBy, setGroupBy] = useLocalStorage<GroupBy>('taskList.groupBy', 'none');
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>('taskList.viewMode', 'list');

  // Filter panel open/closed
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  // Build backend filter from UI state
  const taskFilter: TaskFilter = {};
  if (currentProjectId) taskFilter.projectId = currentProjectId;
  if (filters.search) taskFilter.search = filters.search;
  if (filters.status) taskFilter.status = filters.status;
  if (filters.assignee) taskFilter.assignee = filters.assignee;
  if (filters.priority) taskFilter.priority = Number(filters.priority);
  if (filters.pipelineId) taskFilter.pipelineId = filters.pipelineId;
  if (filters.tag) taskFilter.tag = filters.tag;

  if (filters.featureId) {
    if (filters.featureId === '__none__') {
      taskFilter.featureId = null;
    } else {
      taskFilter.featureId = filters.featureId;
    }
  }
  if (filters.createdBy) taskFilter.createdBy = filters.createdBy as TaskCreatedBy;

  const { tasks, loading, error, refetch } = useTasks(taskFilter);
  const { pipelines } = usePipelines();
  const { features } = useFeatures(currentProjectId ? { projectId: currentProjectId } : undefined);

  // Derived data
  const pipelineMap = useMemo(() => buildPipelineMap(pipelines), [pipelines]);
  const featureMap = useMemo(() => buildFeatureMap(features), [features]);
  const availableTags = useMemo(() => collectTags(tasks), [tasks]);
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
    let errorReported = false;
    const fetchActive = () => {
      window.api.agents.activeTaskIds().then((ids: string[]) => {
        if (mounted) { setActiveTaskIds(new Set(ids)); errorReported = false; }
      }).catch((err) => {
        if (!errorReported) { reportError(err, 'Fetch active agents'); errorReported = true; }
      });
    };
    fetchActive();
    const interval = setInterval(fetchActive, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Create dialog
  const [defaultPipelineId, setDefaultPipelineId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Omit<TaskCreateInput, 'projectId'>>({ pipelineId: '', title: '', description: '', type: 'feature' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    window.api.settings.get().then((s: AppSettings) => setDefaultPipelineId(s.defaultPipelineId))
      .catch((err) => reportError(err, 'Load default pipeline'));
  }, []);

  const openCreateDialog = () => {
    const prefill = (defaultPipelineId && pipelines.some((p) => p.id === defaultPipelineId))
      ? defaultPipelineId : '';
    setForm({ pipelineId: prefill, title: '', description: '', type: 'feature' });
    setDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!form.title.trim() || !currentProjectId || !form.pipelineId) return;
    setCreating(true);
    try {
      const task = await window.api.tasks.create({ ...form, projectId: currentProjectId });
      setDialogOpen(false);
      setForm({ pipelineId: '', title: '', description: '', type: 'feature' });
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
    setSelectMode(true); // auto-enter select mode when any checkbox is clicked
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
      debugInfo: task.debugInfo ?? undefined,
      priority: task.priority,
      assignee: task.assignee ?? undefined,
      tags: task.tags,
    });
    navigate(`/tasks/${newTask.id}`);
  };

  // Status change
  const handleStatusChange = async (taskId: string, toStatus: string) => {
    try {
      const result = await window.api.tasks.transition(taskId, toStatus, 'admin');
      if (result.success) {
        toast.success(`Status changed to "${toStatus}"`);
        await refetch();
      } else if (result.guardFailures && result.guardFailures.length > 0) {
        const reasons = result.guardFailures.map((g) => g.reason).join('; ');
        reportError(`Transition blocked: ${reasons}`, 'Transition');
      } else {
        reportError(result.error ?? 'Unknown error', 'Transition');
      }
    } catch (err) {
      reportError(err, 'Transition');
    }
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  // Loading / error / no project states
  if (projectLoading || loading) {
    return <div className="p-8"><p className="text-muted-foreground">Loading tasks...</p></div>;
  }
  if (error) {
    return <div className="p-8"><InlineError message={error} context="Tasks" /></div>;
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
      {/* Page title */}
      <h1 className="text-2xl font-bold mb-4">Tasks</h1>

      {/* Unified toolbar */}
      <div className="mb-2">
        <TaskToolbar
          filters={filters}
          onFiltersChange={setFilters}
          filterPanelOpen={filterPanelOpen}
          onFilterPanelToggle={() => setFilterPanelOpen((o) => !o)}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortFieldChange={setSortField}
          onSortDirectionToggle={() => setSortDirection((d) => d === 'asc' ? 'desc' : 'asc')}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          pipelines={pipelines}
          features={features}
          statusSummary={
            sortedTasks.length > 0
              ? <TaskStatusSummary tasks={sortedTasks} pipelineMap={pipelineMap} />
              : undefined
          }
        />
      </div>

      {/* Collapsible filter panel */}
      <TaskFilterPanel
        open={filterPanelOpen}
        filters={filters}
        onFiltersChange={setFilters}
        statuses={allStatuses}
        pipelines={pipelines}
        tags={availableTags}
        features={features}
      />

      {/* Task list */}
      {sortedTasks.length === 0 ? (
        <div className="mt-4">
          <TaskEmptyState
            hasFilters={hasActiveFilters}
            onClearFilters={() => setFilters(EMPTY_FILTERS)}
            onCreateTask={openCreateDialog}
          />
        </div>
      ) : (
        <div className={`mt-4 ${selectedIds.size > 0 ? 'pb-20' : ''}`}>
          {/* Floating bulk action bar — visible when items are selected */}
          {selectedIds.size > 0 && (
            <TaskBulkActionBar
              selectedCount={selectedIds.size}
              totalCount={tasks.length}
              allSelected={allSelected}
              someSelected={someSelected}
              onSelectAll={toggleSelectAll}
              onDeleteSelected={() => setBulkDeleteOpen(true)}
              onExit={exitSelectMode}
            />
          )}

          {!selectMode && tasks.length > 0 && (
            <div className="flex justify-end mb-2">
              <button
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                onClick={() => setSelectMode(true)}
              >
                Select tasks
              </button>
            </div>
          )}

          <TaskGroupedList
            tasks={sortedTasks}
            groupBy={groupBy}
            viewMode={viewMode}
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
        </div>
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
