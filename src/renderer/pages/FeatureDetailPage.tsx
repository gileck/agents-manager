import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import { useFeature } from '../hooks/useFeatures';
import { useTasks } from '../hooks/useTasks';
import { usePipelines } from '../hooks/usePipelines';
import { PipelineBadge } from '../components/pipeline/PipelineBadge';
import {
  buildPipelineMap, computeFeatureStatus, computeDependencyLayers, formatRelativeTimestamp, PRIORITY_LABELS,
} from '../components/tasks/task-helpers';
import type { Task, FeatureStatus, FeatureUpdateInput, TaskCreateInput, AppSettings } from '../../shared/types';

const STATUS_COLORS: Record<FeatureStatus, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', label: 'Open' },
  in_progress: { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-700 dark:text-blue-300', label: 'In Progress' },
  done: { bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-700 dark:text-green-300', label: 'Done' },
};

export function FeatureDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { feature, loading, error, refetch } = useFeature(id!);
  const { tasks, refetch: refetchTasks } = useTasks(
    feature ? { featureId: feature.id } : undefined,
  );
  const { pipelines } = usePipelines();
  const pipelineMap = useMemo(() => buildPipelineMap(pipelines), [pipelines]);

  const featureWithProgress = useMemo(
    () => feature ? computeFeatureStatus(feature, tasks, pipelineMap) : null,
    [feature, tasks, pipelineMap],
  );

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<FeatureUpdateInput>({});
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Create task dialog
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<Omit<TaskCreateInput, 'projectId'>>({ pipelineId: '', title: '', description: '' });
  const [taskDeps, setTaskDeps] = useState<string[]>([]);
  const [creatingTask, setCreatingTask] = useState(false);

  // View toggle: list vs layers
  const [viewMode, setViewMode] = useState<'list' | 'layers'>('list');

  // Dependency layers data
  const [depsMap, setDepsMap] = useState<Map<string, string[]>>(new Map());
  const [layersLoading, setLayersLoading] = useState(false);

  const fetchDepsMap = useCallback(async () => {
    if (tasks.length === 0) return;
    setLayersLoading(true);
    try {
      const map = new Map<string, string[]>();
      await Promise.all(
        tasks.map(async (t) => {
          const deps: Task[] = await window.api.tasks.dependencies(t.id);
          map.set(t.id, deps.map((d) => d.id));
        }),
      );
      setDepsMap(map);
    } finally {
      setLayersLoading(false);
    }
  }, [tasks.map((t) => t.id).join(',')]);

  useEffect(() => {
    if (viewMode === 'layers') {
      fetchDepsMap();
    }
  }, [viewMode, fetchDepsMap]);

  const dependencyLayers = useMemo(
    () => (viewMode === 'layers' ? computeDependencyLayers(tasks, depsMap) : []),
    [viewMode, tasks, depsMap],
  );

  const openEdit = () => {
    if (feature) {
      setEditForm({ title: feature.title, description: feature.description ?? '' });
      setEditOpen(true);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await window.api.features.update(id, editForm);
      setEditOpen(false);
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await window.api.features.delete(id);
      navigate('/features');
    } finally {
      setDeleting(false);
    }
  };

  const openTaskDialog = async () => {
    const settings: AppSettings = await window.api.settings.get();
    const prefill = (settings.defaultPipelineId && pipelines.some((p) => p.id === settings.defaultPipelineId))
      ? settings.defaultPipelineId : '';
    setTaskForm({ pipelineId: prefill, title: '', description: '', featureId: id });
    setTaskDeps([]);
    setTaskDialogOpen(true);
  };

  const handleCreateTask = async () => {
    if (!taskForm.title.trim() || !feature || !taskForm.pipelineId) return;
    setCreatingTask(true);
    try {
      const task = await window.api.tasks.create({
        ...taskForm,
        projectId: feature.projectId,
        featureId: id,
      });
      // Add dependencies (best-effort — don't block navigation on failure)
      for (const depId of taskDeps) {
        try {
          await window.api.tasks.addDependency(task.id, depId);
        } catch {
          // dependency may fail (e.g. circular), continue with the rest
        }
      }
      setTaskDialogOpen(false);
      await refetchTasks();
      await refetch();
      navigate(`/tasks/${task.id}`);
    } finally {
      setCreatingTask(false);
    }
  };

  const handleRemoveFromFeature = async (taskId: string) => {
    await window.api.tasks.update(taskId, { featureId: null });
    await refetchTasks();
    await refetch();
  };

  if (loading && !feature) {
    return <div className="p-8"><p className="text-muted-foreground">Loading feature...</p></div>;
  }
  if (error || !feature || !featureWithProgress) {
    return <div className="p-8"><p className="text-destructive">{error || 'Feature not found'}</p></div>;
  }

  const statusStyle = STATUS_COLORS[featureWithProgress.status];
  const progressPct = featureWithProgress.totalTasks > 0
    ? Math.round((featureWithProgress.doneTasks / featureWithProgress.totalTasks) * 100)
    : 0;

  return (
    <div className="p-8">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/features')}>
        &larr; Back to Features
      </Button>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Badge className={`${statusStyle.bg} ${statusStyle.text} border-0`}>
            {statusStyle.label}
          </Badge>
          <h1 className="text-3xl font-bold">{feature.title}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openEdit}>Edit</Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Delete</Button>
        </div>
      </div>

      {/* Progress bar */}
      {featureWithProgress.totalTasks > 0 && (
        <div className="mb-6 flex items-center gap-3">
          <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-sm text-muted-foreground">
            {featureWithProgress.doneTasks}/{featureWithProgress.totalTasks} tasks done ({progressPct}%)
          </span>
        </div>
      )}

      {/* Description */}
      {feature.description && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <p className="text-sm">{feature.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Tasks section */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Tasks</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            <button
              className={`px-3 py-1 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
            <button
              className={`px-3 py-1 text-xs font-medium transition-colors ${viewMode === 'layers' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              onClick={() => setViewMode('layers')}
            >
              Layers
            </button>
          </div>
          <Button size="sm" onClick={openTaskDialog}>Add Task</Button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground mb-4">No tasks in this feature yet.</p>
            <Button onClick={openTaskDialog}>Add Task</Button>
          </CardContent>
        </Card>
      ) : viewMode === 'list' ? (
        <div className="space-y-2">
          {tasks.map((task) => {
            const pipeline = pipelineMap.get(task.pipelineId) ?? null;
            return (
              <Card
                key={task.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                <CardContent className="py-3">
                  <div className="flex items-center gap-3">
                    <PipelineBadge status={task.status} pipeline={pipeline} />
                    <Badge variant="outline">P{task.priority}</Badge>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium truncate">{task.title}</span>
                      {task.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{task.description}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTimestamp(task.updatedAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFromFeature(task.id);
                      }}
                      title="Remove from feature"
                    >
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        /* Layers view */
        layersLoading ? (
          <p className="text-sm text-muted-foreground py-4">Loading dependency layers...</p>
        ) : (
          <div className="space-y-4">
            {dependencyLayers.map((layer, layerIdx) => {
              const label = layerIdx === 0
                ? 'Layer 1 (can start immediately)'
                : `Layer ${layerIdx + 1} (after Layer ${layerIdx})`;

              return (
                <div key={layerIdx}>
                  {layerIdx > 0 && (
                    <div className="flex items-center gap-2 my-2">
                      <div className="flex-1 border-t border-dashed" />
                      <span className="text-xs text-muted-foreground">&#x25BC;</span>
                      <div className="flex-1 border-t border-dashed" />
                    </div>
                  )}
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground mb-2 block">
                      {label}
                    </span>
                    <div className="space-y-1">
                      {layer.map((task) => {
                        const pipeline = pipelineMap.get(task.pipelineId) ?? null;
                        return (
                          <Card
                            key={task.id}
                            className="cursor-pointer hover:bg-accent/50 transition-colors"
                            onClick={() => navigate(`/tasks/${task.id}`)}
                          >
                            <CardContent className="py-2">
                              <div className="flex items-center gap-3">
                                <PipelineBadge status={task.status} pipeline={pipeline} />
                                <span className="text-sm font-medium truncate flex-1">{task.title}</span>
                                <span className="text-xs text-muted-foreground">
                                  {formatRelativeTimestamp(task.updatedAt)}
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Feature</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={editForm.title ?? ''}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={editForm.description ?? ''}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Feature</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            Are you sure you want to delete &quot;{feature.title}&quot;? Tasks will be unlinked from this feature, not deleted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Task Dialog */}
      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={taskForm.pipelineId} onValueChange={(v) => setTaskForm({ ...taskForm, pipelineId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={taskForm.title}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                placeholder="Task title"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={taskForm.description ?? ''}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            {tasks.length > 0 && (
              <div className="space-y-2">
                <Label>Depends on (optional)</Label>
                <div className="max-h-32 overflow-y-auto space-y-1 border rounded p-2">
                  {tasks.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={taskDeps.includes(t.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTaskDeps([...taskDeps, t.id]);
                          } else {
                            setTaskDeps(taskDeps.filter((d) => d !== t.id));
                          }
                        }}
                      />
                      <span className="truncate">{t.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateTask}
              disabled={creatingTask || !taskForm.title.trim() || !taskForm.pipelineId}
            >
              {creatingTask ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
