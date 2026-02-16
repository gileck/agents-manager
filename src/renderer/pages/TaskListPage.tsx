import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { useProjects } from '../hooks/useProjects';
import { usePipelines, usePipeline } from '../hooks/usePipelines';
import { PipelineBadge } from '../components/pipeline/PipelineBadge';
import type { TaskFilter, TaskCreateInput } from '../../shared/types';

export function TaskListPage() {
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId') ?? undefined;

  const [statusFilter, setStatusFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  const filter: TaskFilter = {};
  if (projectIdParam) filter.projectId = projectIdParam;
  if (statusFilter) filter.status = statusFilter;
  if (assigneeFilter) filter.assignee = assigneeFilter;

  const { tasks, loading, error, refetch } = useTasks(filter);
  const { projects } = useProjects();
  const { pipelines } = usePipelines();
  const navigate = useNavigate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<TaskCreateInput>({
    projectId: '',
    pipelineId: '',
    title: '',
    description: '',
  });
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.projectId || !form.pipelineId) return;
    setCreating(true);
    try {
      const task = await window.api.tasks.create(form);
      setDialogOpen(false);
      setForm({ projectId: '', pipelineId: '', title: '', description: '' });
      await refetch();
      navigate(`/tasks/${task.id}`);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
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

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Tasks</h1>
        <Button onClick={() => setDialogOpen(true)}>New Task</Button>
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
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onClick={() => navigate(`/tasks/${task.id}`)} />
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
              <Label>Project</Label>
              <Select value={form.projectId} onValueChange={(v) => setForm({ ...form, projectId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              disabled={creating || !form.title.trim() || !form.projectId || !form.pipelineId}
            >
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskRow({ task, onClick }: { task: { id: string; title: string; status: string; priority: number; assignee: string | null; pipelineId: string }; onClick: () => void }) {
  const { pipeline } = usePipeline(task.pipelineId);
  return (
    <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={onClick}>
      <CardContent className="py-3">
        <div className="flex items-center gap-3">
          <PipelineBadge status={task.status} pipeline={pipeline} />
          <Badge variant="outline">P{task.priority}</Badge>
          <span className="font-medium">{task.title}</span>
          {task.assignee && (
            <span className="text-sm text-muted-foreground ml-auto">{task.assignee}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
