import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { useTasks } from '../hooks/useTasks';
import { PipelineBadge } from '../components/pipeline/PipelineBadge';
import { usePipeline } from '../hooks/usePipelines';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import type { Project, ProjectUpdateInput } from '../../shared/types';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, loading, error, refetch } = useIpc<Project | null>(
    () => window.api.projects.get(id!),
    [id]
  );
  const { tasks } = useTasks({ projectId: id });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<ProjectUpdateInput>({});
  const [saving, setSaving] = useState(false);

  const [editModel, setEditModel] = useState('');
  const [editPullMain, setEditPullMain] = useState(false);

  const MODEL_OPTIONS = [
    { label: 'Default', value: '' },
    { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
    { label: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
    { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
  ];

  const openEdit = () => {
    if (project) {
      setEditForm({ name: project.name, description: project.description ?? '', path: project.path ?? '' });
      setEditModel((project.config?.model as string) ?? '');
      setEditPullMain(!!project.config?.pullMainAfterMerge);
      setEditOpen(true);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const update: ProjectUpdateInput = {
        ...editForm,
        config: { ...(project?.config ?? {}), model: editModel || undefined, pullMainAfterMerge: editPullMain },
      };
      await window.api.projects.update(id, update);
      setEditOpen(false);
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  const { currentProjectId, setCurrentProjectId } = useCurrentProject();

  const handleDelete = async () => {
    if (!id) return;
    await window.api.projects.delete(id);
    if (currentProjectId === id) {
      await setCurrentProjectId(null);
    }
    navigate('/projects');
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading project...</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-8">
        <p className="text-destructive">{error || 'Project not found'}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(-1 as any)}>
        &larr; Back
      </Button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">{project.name}</h1>
          {project.description && (
            <p className="text-muted-foreground mt-1">{project.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(`/projects/${id}/config`)}>Configuration</Button>
          <Button variant="outline" onClick={openEdit}>Edit</Button>
          <Button variant="destructive" onClick={handleDelete}>Delete</Button>
        </div>
      </div>

      {project.path && (
        <Card className="mb-6">
          <CardContent className="py-3">
            <span className="text-sm text-muted-foreground">Path: </span>
            <span className="text-sm font-mono">{project.path}</span>
          </CardContent>
        </Card>
      )}

      <h2 className="text-xl font-semibold mb-4">Tasks ({tasks.length})</h2>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No tasks in this project.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onClick={() => navigate(`/tasks/${task.id}`)} />
          ))}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editForm.name ?? ''}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-desc">Description</Label>
              <Input
                id="edit-desc"
                value={editForm.description ?? ''}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-path">Path</Label>
              <Input
                id="edit-path"
                value={editForm.path ?? ''}
                onChange={(e) => setEditForm({ ...editForm, path: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-model">Model</Label>
              <select
                id="edit-model"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit-pull-main"
                checked={editPullMain}
                onChange={(e) => setEditPullMain(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="edit-pull-main">Pull main after PR merge</Label>
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
    </div>
  );
}

function TaskRow({ task, onClick }: { task: { id: string; title: string; status: string; priority: number; pipelineId: string }; onClick: () => void }) {
  const { pipeline } = usePipeline(task.pipelineId);
  return (
    <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={onClick}>
      <CardContent className="py-3">
        <div className="flex items-center gap-3">
          <PipelineBadge status={task.status} pipeline={pipeline} />
          <span className="font-medium">{task.title}</span>
          <Badge variant="outline" className="ml-auto">P{task.priority}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
