import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import { useTask } from '../hooks/useTasks';
import { usePipeline } from '../hooks/usePipelines';
import { PipelineBadge } from '../components/pipeline/PipelineBadge';
import { useIpc } from '@template/renderer/hooks/useIpc';
import type {
  Transition, TaskEvent, TaskArtifact, AgentRun, TaskUpdateInput,
} from '../../shared/types';

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { task, loading, error, refetch } = useTask(id!);
  const { pipeline } = usePipeline(task?.pipelineId);

  const { data: transitions, refetch: refetchTransitions } = useIpc<Transition[]>(
    () => id ? window.api.tasks.transitions(id) : Promise.resolve([]),
    [id, task?.status]
  );

  const { data: events } = useIpc<TaskEvent[]>(
    () => id ? window.api.events.list({ taskId: id }) : Promise.resolve([]),
    [id]
  );

  const { data: artifacts } = useIpc<TaskArtifact[]>(
    () => id ? window.api.artifacts.list(id) : Promise.resolve([]),
    [id]
  );

  const { data: agentRuns } = useIpc<AgentRun[]>(
    () => id ? window.api.agents.runs(id) : Promise.resolve([]),
    [id]
  );

  const [tab, setTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<TaskUpdateInput>({});
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [startingAgent, setStartingAgent] = useState(false);

  const openEdit = () => {
    if (task) {
      setEditForm({
        title: task.title,
        description: task.description ?? '',
        priority: task.priority,
        assignee: task.assignee ?? '',
      });
      setEditOpen(true);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await window.api.tasks.update(id, editForm);
      setEditOpen(false);
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  const handleTransition = async (toStatus: string) => {
    if (!id) return;
    setTransitioning(toStatus);
    try {
      const result = await window.api.tasks.transition(id, toStatus);
      if (result.success) {
        await refetch();
        await refetchTransitions();
      }
    } finally {
      setTransitioning(null);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    await window.api.tasks.delete(id);
    navigate('/tasks');
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading task...</p>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="p-8">
        <p className="text-destructive">{error || 'Task not found'}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <PipelineBadge status={task.status} pipeline={pipeline} />
          <h1 className="text-3xl font-bold">{task.title}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openEdit}>Edit</Button>
          <Button variant="destructive" onClick={handleDelete}>Delete</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transitions">Transitions</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="agents">Agent Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card className="mt-4">
            <CardContent className="py-4">
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.75rem', alignItems: 'start' }}>
                <span className="text-sm text-muted-foreground">Status</span>
                <PipelineBadge status={task.status} pipeline={pipeline} />

                <span className="text-sm text-muted-foreground">Priority</span>
                <Badge variant="outline">P{task.priority}</Badge>

                <span className="text-sm text-muted-foreground">Assignee</span>
                <span className="text-sm">{task.assignee || 'Unassigned'}</span>

                <span className="text-sm text-muted-foreground">Description</span>
                <span className="text-sm">{task.description || 'No description'}</span>

                {task.prLink && (
                  <>
                    <span className="text-sm text-muted-foreground">PR</span>
                    <span className="text-sm font-mono">{task.prLink}</span>
                  </>
                )}

                {task.branchName && (
                  <>
                    <span className="text-sm text-muted-foreground">Branch</span>
                    <span className="text-sm font-mono">{task.branchName}</span>
                  </>
                )}

                {task.tags.length > 0 && (
                  <>
                    <span className="text-sm text-muted-foreground">Tags</span>
                    <div className="flex gap-1">
                      {task.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transitions">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Available Transitions</CardTitle>
            </CardHeader>
            <CardContent>
              {!transitions || transitions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No transitions available from current status.</p>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {transitions.map((t) => (
                    <Button
                      key={t.to}
                      variant="outline"
                      onClick={() => handleTransition(t.to)}
                      disabled={transitioning !== null}
                    >
                      {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Event Log</CardTitle>
            </CardHeader>
            <CardContent>
              {!events || events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events recorded.</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <div key={event.id} className="flex items-start gap-2 text-sm">
                      <Badge variant={event.severity === 'error' ? 'destructive' : event.severity === 'warning' ? 'warning' : 'secondary'} className="text-xs shrink-0">
                        {event.category}
                      </Badge>
                      <span>{event.message}</span>
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="artifacts">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Artifacts</CardTitle>
            </CardHeader>
            <CardContent>
              {!artifacts || artifacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No artifacts.</p>
              ) : (
                <div className="space-y-3">
                  {artifacts.map((artifact) => (
                    <div key={artifact.id} className="flex items-start gap-2">
                      <Badge variant="outline">{artifact.type}</Badge>
                      <pre className="text-xs bg-muted p-2 rounded flex-1 overflow-x-auto">
                        {JSON.stringify(artifact.data, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents">
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Agent Runs</CardTitle>
                <Button
                  size="sm"
                  disabled={startingAgent}
                  onClick={async () => {
                    setStartingAgent(true);
                    try {
                      await window.api.agents.start(id!, 'plan');
                      await refetch();
                    } finally {
                      setStartingAgent(false);
                    }
                  }}
                >
                  {startingAgent ? 'Starting...' : 'Start Agent'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!agentRuns || agentRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No agent runs.</p>
              ) : (
                <div className="space-y-3">
                  {agentRuns.map((run) => (
                    <Card
                      key={run.id}
                      className="cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => navigate(`/agents/${run.id}`)}
                    >
                      <CardContent className="py-3">
                        <div className="flex items-center gap-3">
                          <Badge variant={run.status === 'completed' ? 'success' : run.status === 'running' ? 'default' : 'destructive'}>
                            {run.status}
                          </Badge>
                          <span className="text-sm">{run.mode} / {run.agentType}</span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {new Date(run.startedAt).toLocaleString()}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
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
              <Input
                value={editForm.description ?? ''}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Input
                type="number"
                value={editForm.priority ?? 0}
                onChange={(e) => setEditForm({ ...editForm, priority: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label>Assignee</Label>
              <Input
                value={editForm.assignee ?? ''}
                onChange={(e) => setEditForm({ ...editForm, assignee: e.target.value || null })}
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
    </div>
  );
}
