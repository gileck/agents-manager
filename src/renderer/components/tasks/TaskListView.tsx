import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../ui/card';
import { InlineError } from '../InlineError';
import { useTasks } from '../../hooks/useTasks';
import { usePipelines } from '../../hooks/usePipelines';
import { reportError } from '../../lib/error-handler';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { EMPTY_FILTERS } from './TaskFilterBar';
import { TaskStatusSummary } from './TaskStatusSummary';
import { TaskEmptyState } from './TaskEmptyState';
import { TaskGroupedList } from './TaskGroupedList';
import { TaskCreateDialog } from './TaskCreateDialog';
import { TaskDeleteDialog, BulkDeleteDialog } from './TaskDeleteDialogs';
import { TaskToolbar } from './TaskToolbar';
import { TaskFilterPanel } from './TaskFilterPanel';
import { TaskBulkActionBar } from './TaskBulkActionBar';
import { TaskBatchEditDialog, type BatchEditState } from './TaskBatchEditDialog';
import { useFeatures } from '../../hooks/useFeatures';
import { sortTasks, collectTags, buildPipelineMap, buildFeatureMap } from './task-helpers';
import type { FilterState } from './TaskFilterBar';
import type { SortField, SortDirection, GroupBy, ViewMode } from './task-helpers';
import { toast } from 'sonner';
import type { Task, TaskFilter, TaskCreateInput, TaskUpdateInput, AppSettings, TaskCreatedBy, ChatImage } from '../../../shared/types';
import { useLocalStorage } from '../../hooks/useLocalStorage';

export function TaskListView() {
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
  const [dialogImages, setDialogImages] = useState<ChatImage[]>([]);

  useEffect(() => {
    window.api.settings.get().then((s: AppSettings) => setDefaultPipelineId(s.defaultPipelineId))
      .catch((err) => reportError(err, 'Load default pipeline'));
  }, []);

  const openCreateDialog = () => {
    const prefill = (defaultPipelineId && pipelines.some((p) => p.id === defaultPipelineId))
      ? defaultPipelineId : '';
    setForm({ pipelineId: prefill, title: '', description: '', type: 'feature' });
    setDialogImages([]);
    setDialogOpen(true);
  };

  /** Internal helper: creates the task and returns it (shared by Create and Create+Triage) */
  const doCreateTask = async (): Promise<import('../../../shared/types').Task | null> => {
    if (!form.title.trim() || !currentProjectId || !form.pipelineId) return null;
    let description = form.description ?? '';

    // Save screenshots if any
    if (dialogImages.length > 0) {
      try {
        const { paths } = await window.api.screenshots.save(dialogImages);
        if (paths.length > 0) {
          const screenshotSection = '\n\n## Screenshots\n' +
            paths.map((p, i) => `![screenshot-${i + 1}](${p})`).join('\n');
          description = description + screenshotSection;
        }
      } catch (err) {
        reportError(err, 'Save screenshots');
      }
    }

    return window.api.tasks.create({ ...form, description, projectId: currentProjectId });
  };

  const handleCreate = async () => {
    if (!form.title.trim() || !currentProjectId || !form.pipelineId) return;
    setCreating(true);
    try {
      const task = await doCreateTask();
      if (!task) return;
      setDialogOpen(false);
      setForm({ pipelineId: '', title: '', description: '', type: 'feature' });
      setDialogImages([]);
      await refetch();
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      reportError(err, 'Create task');
    } finally {
      setCreating(false);
    }
  };

  const handleCreateAndTriage = async () => {
    if (!form.title.trim() || !currentProjectId || !form.pipelineId) return;
    setCreating(true);
    try {
      const task = await doCreateTask();
      if (!task) return;
      // Transition to triaging (triggers the triager agent via pipeline hook)
      await window.api.tasks.transition(task.id, 'triaging', 'admin');
      setDialogOpen(false);
      setForm({ pipelineId: '', title: '', description: '', type: 'feature' });
      setDialogImages([]);
      await refetch();
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      reportError(err, 'Create + Triage');
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
    } catch (err) {
      reportError(err, 'Delete task');
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
  const handleToggleSelectGroup = (taskIds: string[]) => {
    setSelectedIds((prev) => {
      const allSelected_ = taskIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected_) {
        taskIds.forEach((id) => next.delete(id));
      } else {
        taskIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      const failed: string[] = [];
      for (const id of selectedIds) {
        try {
          await window.api.tasks.delete(id);
        } catch {
          failed.push(id);
        }
      }
      if (failed.length > 0) {
        reportError(`Failed to delete ${failed.length} of ${selectedIds.size} tasks`, 'Bulk delete');
      }
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      setSelectMode(false);
      await refetch();
    } catch (err) {
      reportError(err, 'Bulk delete');
    } finally {
      setBulkDeleting(false);
    }
  };

  // Batch update
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);

  const selectedTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const id of selectedIds) {
      const task = tasks.find((t) => t.id === id);
      task?.tags.forEach((tag) => tagSet.add(tag));
    }
    return Array.from(tagSet).sort();
  }, [selectedIds, tasks]);

  const showBatchResultToast = (succeeded: number, failed: Array<{ title: string; error: string }>) => {
    const total = succeeded + failed.length;
    if (failed.length === 0) {
      toast.success(`Updated ${succeeded} task${succeeded !== 1 ? 's' : ''}`);
    } else if (succeeded > 0) {
      toast.warning(`Updated ${succeeded} of ${total} tasks. ${failed.length} failed.`);
    } else {
      toast.error(`All ${total} updates failed.`);
    }
  };

  const handleBatchUpdate = async (state: BatchEditState) => {
    setBatchUpdating(true);
    setBatchEditOpen(false);
    let succeeded = 0;
    const failed: Array<{ id: string; title: string; error: string }> = [];

    for (const id of selectedIds) {
      const task = tasks.find((t) => t.id === id);
      try {
        const input: TaskUpdateInput = {};
        if (state.priority.enabled)   input.priority   = state.priority.value;
        if (state.assignee.enabled)   input.assignee   = state.assignee.value || null;
        if (state.featureId.enabled)  input.featureId  = state.featureId.value || null;
        if (state.pipelineId.enabled) input.pipelineId = state.pipelineId.value;
        if (state.type.enabled)       input.type       = state.type.value;
        if (state.size.enabled)       input.size       = state.size.value || null;
        if (state.complexity.enabled) input.complexity = state.complexity.value || null;
        if (state.tags.enabled) {
          if (state.tags.mode === 'replace') {
            input.tags = state.tags.values;
          } else if (state.tags.mode === 'add') {
            input.tags = [...new Set([...(task?.tags ?? []), ...state.tags.values])];
          } else {
            input.tags = (task?.tags ?? []).filter((t) => !state.tags.values.includes(t));
          }
        }
        await window.api.tasks.update(id, input);
        succeeded++;
      } catch (err) {
        failed.push({ id, title: task?.title ?? id, error: String(err) });
      }
    }

    setBatchUpdating(false);
    showBatchResultToast(succeeded, failed);
    if (succeeded > 0) {
      exitSelectMode();
      await refetch();
    }
  };

  const handleBatchPriority = async (priority: number) => {
    setBatchUpdating(true);
    let succeeded = 0;
    const failed: Array<{ id: string; title: string; error: string }> = [];

    for (const id of selectedIds) {
      const task = tasks.find((t) => t.id === id);
      try {
        await window.api.tasks.update(id, { priority });
        succeeded++;
      } catch (err) {
        failed.push({ id, title: task?.title ?? id, error: String(err) });
      }
    }

    setBatchUpdating(false);
    showBatchResultToast(succeeded, failed);
    if (succeeded > 0) {
      exitSelectMode();
      await refetch();
    }
  };

  const handleBatchTransition = async (toStatus: string) => {
    setBatchUpdating(true);
    let succeeded = 0;
    const failed: Array<{ id: string; title: string; error: string }> = [];

    for (const id of selectedIds) {
      const task = tasks.find((t) => t.id === id);
      try {
        const result = await window.api.tasks.forceTransition(id, toStatus, 'admin');
        if (result.success) {
          succeeded++;
        } else {
          failed.push({ id, title: task?.title ?? id, error: result.error ?? 'Transition failed' });
        }
      } catch (err) {
        failed.push({ id, title: task?.title ?? id, error: String(err) });
      }
    }

    setBatchUpdating(false);
    showBatchResultToast(succeeded, failed);
    if (succeeded > 0) {
      exitSelectMode();
      await refetch();
    }
  };

  const handleDuplicate = async (task: Task) => {
    try {
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
    } catch (err) {
      reportError(err, 'Duplicate task');
    }
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
        <Card><CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No project selected. Go to Projects to select one.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-8 pb-8">
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
            selectMode={selectMode}
            onSelectModeToggle={() => setSelectMode(true)}
            hasTasks={tasks.length > 0}
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
          <div className={`mt-4 ${selectedIds.size > 0 ? 'pb-20' : ''} ${batchUpdating ? 'opacity-50 pointer-events-none' : ''}`}>
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
                pipelines={pipelines}
                tasks={tasks}
                features={features}
                onBatchPriority={handleBatchPriority}
                onBatchStatus={handleBatchTransition}
                onBatchEdit={() => setBatchEditOpen(true)}
                batchUpdating={batchUpdating}
              />
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
              onToggleSelectGroup={handleToggleSelectGroup}
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
          images={dialogImages}
          onImagesChange={setDialogImages}
          onCreateAndTriage={handleCreateAndTriage}
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
        <TaskBatchEditDialog
          open={batchEditOpen}
          onClose={() => setBatchEditOpen(false)}
          selectedCount={selectedIds.size}
          pipelines={pipelines}
          features={features}
          existingTags={selectedTags}
          onApply={handleBatchUpdate}
          applying={batchUpdating}
        />
      </div>
    </div>
  );
}
