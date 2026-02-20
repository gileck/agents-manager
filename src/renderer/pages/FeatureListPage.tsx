import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import { useFeatures } from '../hooks/useFeatures';
import { useTasks } from '../hooks/useTasks';
import { usePipelines } from '../hooks/usePipelines';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { buildPipelineMap, computeFeatureStatus, formatRelativeTimestamp } from '../components/tasks/task-helpers';
import type { FeatureStatus } from '../../shared/types';

const STATUS_COLORS: Record<FeatureStatus, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', label: 'Open' },
  in_progress: { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-700 dark:text-blue-300', label: 'In Progress' },
  done: { bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-700 dark:text-green-300', label: 'Done' },
};

export function FeatureListPage() {
  const { currentProjectId, loading: projectLoading } = useCurrentProject();
  const navigate = useNavigate();

  const { features, loading, error } = useFeatures(
    currentProjectId ? { projectId: currentProjectId } : undefined
  );
  const { tasks } = useTasks(currentProjectId ? { projectId: currentProjectId } : undefined);
  const { pipelines } = usePipelines();

  const pipelineMap = useMemo(() => buildPipelineMap(pipelines), [pipelines]);

  const featuresWithProgress = useMemo(
    () => features.map((f) => computeFeatureStatus(f, tasks, pipelineMap)),
    [features, tasks, pipelineMap],
  );

  // Create dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || !currentProjectId) return;
    setCreating(true);
    try {
      const feature = await window.api.features.create({
        projectId: currentProjectId,
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setDialogOpen(false);
      setTitle('');
      setDescription('');
      navigate(`/features/${feature.id}`);
    } finally {
      setCreating(false);
    }
  };

  if (projectLoading || loading) {
    return <div className="p-8"><p className="text-muted-foreground">Loading features...</p></div>;
  }
  if (error) {
    return <div className="p-8"><p className="text-destructive">Error: {error}</p></div>;
  }
  if (!currentProjectId) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-4">Features</h1>
        <Card><CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No project selected. Go to Projects to select one.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Features</h1>
        <Button size="sm" onClick={() => setDialogOpen(true)}>New Feature</Button>
      </div>

      {featuresWithProgress.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground mb-4">No features yet. Create one to group related tasks.</p>
            <Button onClick={() => setDialogOpen(true)}>Create Feature</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {featuresWithProgress.map((feature) => {
            const statusStyle = STATUS_COLORS[feature.status];
            const progressPct = feature.totalTasks > 0
              ? Math.round((feature.doneTasks / feature.totalTasks) * 100)
              : 0;

            return (
              <Card
                key={feature.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => navigate(`/features/${feature.id}`)}
              >
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <Badge className={`${statusStyle.bg} ${statusStyle.text} border-0`}>
                      {statusStyle.label}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{feature.title}</div>
                      {feature.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {feature.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {feature.totalTasks > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-16 text-right">
                            {feature.doneTasks}/{feature.totalTasks}
                          </span>
                        </div>
                      )}
                      <span className="text-xs text-muted-foreground w-16 text-right">
                        {formatRelativeTimestamp(feature.updatedAt)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Feature</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Feature title"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !title.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
