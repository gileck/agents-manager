import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import { useProjects } from '../hooks/useProjects';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import type { ProjectCreateInput } from '../../shared/types';

export function ProjectsPage() {
  const { projects, loading, error, refetch } = useProjects();
  const { currentProjectId, setCurrentProjectId } = useCurrentProject();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ProjectCreateInput>({ name: '', description: '', path: '' });
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const project = await window.api.projects.create(form);
      setDialogOpen(false);
      setForm({ name: '', description: '', path: '' });
      await refetch();
      await setCurrentProjectId(project.id);
      navigate('/tasks');
    } finally {
      setCreating(false);
    }
  };

  const handleSelect = async (projectId: string) => {
    await setCurrentProjectId(projectId);
    navigate('/tasks');
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading projects...</p>
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
        <h1 className="text-3xl font-bold">Projects</h1>
        <Button onClick={() => setDialogOpen(true)}>New Project</Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No projects yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <Card
              key={project.id}
              className={`cursor-pointer hover:bg-accent/50 transition-colors ${project.id === currentProjectId ? 'ring-2 ring-primary' : ''}`}
              onClick={() => handleSelect(project.id)}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{project.name}</div>
                    {project.description && (
                      <div className="text-sm text-muted-foreground">{project.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {project.path && (
                      <span className="text-xs text-muted-foreground font-mono">{project.path}</span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}`); }}
                    >
                      Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My Project"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-desc">Description</Label>
              <Input
                id="project-desc"
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-path">Path</Label>
              <Input
                id="project-path"
                value={form.path ?? ''}
                onChange={(e) => setForm({ ...form, path: e.target.value })}
                placeholder="/path/to/project"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
