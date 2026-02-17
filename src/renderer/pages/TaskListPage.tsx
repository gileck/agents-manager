import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import { useTasks } from '../hooks/useTasks';
import { usePipelines, usePipeline } from '../hooks/usePipelines';
import { PipelineBadge } from '../components/pipeline/PipelineBadge';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import type { Task, TaskFilter, TaskCreateInput } from '../../shared/types';

export function TaskListPage() {
  const { currentProjectId, loading: projectLoading } = useCurrentProject();

  const [statusFilter, setStatusFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  const filter: TaskFilter = {};
  if (currentProjectId) filter.projectId = currentProjectId;
  if (statusFilter) filter.status = statusFilter;
  if (assigneeFilter) filter.assignee = assigneeFilter;

  const { tasks, loading, error, refetch } = useTasks(filter);
  const { pipelines } = usePipelines();
  const navigate = useNavigate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Omit<TaskCreateInput, 'projectId'>>({
    pipelineId: '',
    title: '',
    description: '',
  });
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const allSelected = tasks.length > 0 && selectedIds.size === tasks.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < tasks.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await window.api.tasks.delete(deleteTarget.id);
      setDeleteTarget(null);
      selectedIds.delete(deleteTarget.id);
      setSelectedIds(new Set(selectedIds));
      await refetch();
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      for (const id of selectedIds) {
        await window.api.tasks.delete(id);
      }
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
      tags: task.tags,
    });
    navigate(`/tasks/${newTask.id}`);
  };

  if (projectLoading || loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading tasks...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-destructive">Error: {error}</p>
      </div>
    );
  }

  if (!currentProjectId) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-4">Tasks</h1>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No project selected. Go to Projects to select one.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Tasks</h1>
        <div className="flex items-center gap-2">
          {tasks.length > 0 && (
            <Button
              variant={selectMode ? 'outline' : 'secondary'}
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </Button>
          )}
          <Button onClick={() => setDialogOpen(true)}>New Task</Button>
        </div>
      </div>

      <div className="flex gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Label>Status:</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              {/* Show known statuses from pipelines */}
              {pipelines.flatMap((p) => p.statuses).reduce<string[]>((acc, s) => {
                if (!acc.includes(s.name)) acc.push(s.name);
                return acc;
              }, []).map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label>Assignee:</Label>
          <Input
            className="w-40"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            placeholder="Filter..."
          />
        </div>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No tasks found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Select all bar */}
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
                {selectedIds.size > 0
                  ? `${selectedIds.size} of ${tasks.length} selected`
                  : 'Select all'}
              </span>
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  Delete selected ({selectedIds.size})
                </Button>
              )}
            </div>
          )}

          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              selectMode={selectMode}
              selected={selectedIds.has(task.id)}
              onToggleSelect={() => toggleSelect(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
              onDelete={() => setDeleteTarget(task)}
              onDuplicate={() => handleDuplicate(task)}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={form.pipelineId} onValueChange={(v) => setForm({ ...form, pipelineId: v })}>
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
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Task title"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !form.title.trim() || !form.pipelineId}
            >
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Task</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            Are you sure you want to delete &quot;{deleteTarget?.title}&quot;? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(open) => { if (!open) setBulkDeleteOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} Tasks</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            Are you sure you want to delete {selectedIds.size} task{selectedIds.size > 1 ? 's' : ''}? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size} task${selectedIds.size > 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskRow({ task, selectMode, selected, onToggleSelect, onClick, onDelete, onDuplicate }: {
  task: { id: string; title: string; status: string; priority: number; assignee: string | null; pipelineId: string };
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const { pipeline } = usePipeline(task.pipelineId);
  return (
    <Card className={`cursor-pointer hover:bg-accent/50 transition-colors ${selected ? 'ring-2 ring-primary' : ''}`} onClick={onClick}>
      <CardContent className="py-3">
        <div className="flex items-center gap-3">
          {selectMode && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
            />
          )}
          <PipelineBadge status={task.status} pipeline={pipeline} />
          <Badge variant="outline">P{task.priority}</Badge>
          <span className="font-medium">{task.title}</span>
          <div className="flex items-center gap-2 ml-auto">
            {task.assignee && (
              <span className="text-sm text-muted-foreground">{task.assignee}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            >
              Duplicate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
