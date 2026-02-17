import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import { useTask } from '../hooks/useTasks';
import { usePipeline } from '../hooks/usePipelines';
import { PipelineBadge } from '../components/pipeline/PipelineBadge';
import { useIpc } from '@template/renderer/hooks/useIpc';
import type {
  Transition, TaskArtifact, AgentRun, TaskUpdateInput, PendingPrompt,
  DebugTimelineEntry,
} from '../../shared/types';

// Agent pipeline statuses that have specific bar rendering
const AGENT_STATUSES = new Set(['open', 'planning', 'implementing', 'plan_review', 'pr_review', 'needs_info', 'done']);

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { task, loading, error, refetch } = useTask(id!);
  const { pipeline } = usePipeline(task?.pipelineId);

  const { data: transitions, refetch: refetchTransitions } = useIpc<Transition[]>(
    () => id ? window.api.tasks.transitions(id) : Promise.resolve([]),
    [id, task?.status]
  );

  const { data: debugTimeline, refetch: refetchDebug } = useIpc<DebugTimelineEntry[]>(
    () => id ? window.api.tasks.debugTimeline(id) : Promise.resolve([]),
    [id]
  );

  const { data: artifacts } = useIpc<TaskArtifact[]>(
    () => id ? window.api.artifacts.list(id) : Promise.resolve([]),
    [id]
  );

  const { data: agentRuns, refetch: refetchAgentRuns } = useIpc<AgentRun[]>(
    () => id ? window.api.agents.runs(id) : Promise.resolve([]),
    [id]
  );

  const { data: pendingPrompts, refetch: refetchPrompts } = useIpc<PendingPrompt[]>(
    () => id ? window.api.prompts.list(id) : Promise.resolve([]),
    [id, task?.status]
  );

  // Derived agent state
  const hasRunningAgent = agentRuns?.some((r) => r.status === 'running') ?? false;
  const activeRun = agentRuns?.find((r) => r.status === 'running') ?? null;
  const lastRun = agentRuns?.[0] ?? null;
  const isAgentPhase = task?.status === 'planning' || task?.status === 'implementing';
  // After agent completes, post-completion work (git push, PR creation) may take
  // several seconds before transitioning the task. Don't show "stuck" during this window.
  const isFinalizing = isAgentPhase && !hasRunningAgent && agentRuns !== null
    && lastRun?.status === 'completed' && lastRun.completedAt != null
    && (Date.now() - lastRun.completedAt) < 30000;
  const isStuck = isAgentPhase && !hasRunningAgent && agentRuns !== null && !isFinalizing;

  // Poll while agent is running, needs_info, finalizing, or stuck
  const shouldPoll = hasRunningAgent || task?.status === 'needs_info' || isFinalizing || isStuck;

  useEffect(() => {
    if (!shouldPoll) return;
    const interval = setInterval(() => {
      refetchAgentRuns();
      refetch();
      refetchTransitions();
      refetchPrompts();
      refetchDebug();
    }, 3000);
    return () => clearInterval(interval);
  }, [shouldPoll, refetchAgentRuns, refetch, refetchTransitions, refetchPrompts, refetchDebug]);

  // Completion edge: full refresh when agent finishes
  const prevHasRunning = useRef(hasRunningAgent);
  useEffect(() => {
    if (prevHasRunning.current && !hasRunningAgent) {
      refetch(); refetchTransitions(); refetchAgentRuns(); refetchPrompts(); refetchDebug();
    }
    prevHasRunning.current = hasRunningAgent;
  }, [hasRunningAgent, refetch, refetchTransitions, refetchAgentRuns, refetchPrompts, refetchDebug]);

  const [tab, setTab] = useState('overview');

  // Refetch agent runs when switching to the agents tab
  useEffect(() => {
    if (tab === 'agents') {
      refetchAgentRuns();
    }
  }, [tab, refetchAgentRuns]);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<TaskUpdateInput>({});
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [stoppingAgent, setStoppingAgent] = useState(false);

  // Prompt response state
  const [promptResponse, setPromptResponse] = useState('');
  const [responding, setResponding] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  // Auto-dismiss transition error after 15 seconds
  useEffect(() => {
    if (!transitionError) return;
    const timer = setTimeout(() => setTransitionError(null), 15000);
    return () => clearTimeout(timer);
  }, [transitionError]);

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
    setTransitionError(null);
    try {
      const result = await window.api.tasks.transition(id, toStatus);
      if (result.success) {
        await refetch();
        await refetchTransitions();
        await refetchAgentRuns();
        await refetchPrompts();
      } else {
        const msg = result.guardFailures?.map((g: { reason: string }) => g.reason).join('; ')
          ?? result.error ?? 'Transition failed';
        setTransitionError(msg);
      }
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : 'Connection error. Please try again.');
    } finally {
      setTransitioning(null);
    }
  };

  const handleStopAgent = async () => {
    if (!activeRun) return;
    setStoppingAgent(true);
    try {
      await window.api.agents.stop(activeRun.id);
      await refetchAgentRuns();
      await refetch();
      await refetchTransitions();
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : 'Failed to stop agent.');
    } finally {
      setStoppingAgent(false);
    }
  };

  const handlePromptRespond = async (promptId: string) => {
    setResponding(true);
    setPromptError(null);
    try {
      const result = await window.api.prompts.respond(promptId, { answer: promptResponse });
      if (!result) {
        setPromptError('This prompt has already been answered.');
      } else {
        setPromptResponse('');
      }
      await refetchPrompts();
      await refetch();
      await refetchTransitions();
      await refetchAgentRuns();
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Failed to submit response. Please try again.');
    } finally {
      setResponding(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await window.api.tasks.delete(id);
      navigate('/tasks');
    } finally {
      setDeleting(false);
    }
  };

  const handleDuplicate = async () => {
    if (!task) return;
    setDuplicating(true);
    try {
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
    } finally {
      setDuplicating(false);
    }
  };

  if (loading && !task) {
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

  // Determine which transitions are "primary" (shown in the status bar)
  // vs "secondary" (shown at bottom of overview)
  const isAgentPipeline = AGENT_STATUSES.has(task.status);
  const primaryTransitionTargets = getPrimaryTransitionTargets(task.status, isStuck);
  const primaryTransitions = isAgentPipeline
    ? (transitions ?? []).filter((t) => primaryTransitionTargets.has(t.to))
    : (transitions ?? []); // Non-agent pipelines: all transitions in bar
  const secondaryTransitions = isAgentPipeline
    ? (transitions ?? []).filter((t) => !primaryTransitionTargets.has(t.to))
    : [];

  return (
    <div className="p-8">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(-1 as any)}>
        &larr; Back
      </Button>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <PipelineBadge status={task.status} pipeline={pipeline} />
          <h1 className="text-3xl font-bold">{task.title}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDuplicate} disabled={duplicating}>
            {duplicating ? 'Duplicating...' : 'Duplicate'}
          </Button>
          <Button variant="outline" onClick={openEdit}>Edit</Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Delete</Button>
        </div>
      </div>

      {/* Inline compact pipeline progress bar */}
      {pipeline && (
        <PipelineProgress
          pipeline={pipeline}
          currentStatus={task.status}
          transitionEntries={(debugTimeline ?? []).filter((e) => e.source === 'transition')}
        />
      )}

      {/* Status Action Bar — defer for agent pipelines until agentRuns loads */}
      {(!isAgentPipeline || agentRuns !== null) && (
        <StatusActionBar
          task={task}
          isAgentPipeline={isAgentPipeline}
          hasRunningAgent={hasRunningAgent}
          activeRun={activeRun}
          lastRun={lastRun}
          isStuck={isStuck}
          isFinalizing={isFinalizing}
          primaryTransitions={primaryTransitions}
          transitioning={transitioning}
          stoppingAgent={stoppingAgent}
          onTransition={handleTransition}
          onStopAgent={handleStopAgent}
          onNavigateToRun={(runId) => navigate(`/agents/${runId}`)}
        />
      )}

      {/* Transition Error Banner */}
      {transitionError && (
        <div
          className="mb-4 rounded-md px-4 py-3 text-sm text-white flex items-center justify-between"
          style={{ backgroundColor: '#dc2626' }}
        >
          <span>{transitionError}</span>
          <button
            className="ml-4 text-white hover:opacity-80 font-bold text-lg leading-none"
            onClick={() => setTransitionError(null)}
          >
            &times;
          </button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="agents">Agent Runs</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
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

          {/* Pending Prompt UI (needs_info) */}
          {task.status === 'needs_info' && pendingPrompts && pendingPrompts.length > 0 && (
            <Card className="mt-4 border-amber-400">
              <CardHeader className="py-3">
                <CardTitle className="text-base text-amber-600">Agent needs more information</CardTitle>
              </CardHeader>
              <CardContent>
                {pendingPrompts.filter((p) => p.status === 'pending').map((prompt) => (
                  <div key={prompt.id} className="space-y-3">
                    <div className="text-sm">
                      {renderPromptQuestions(prompt.payload)}
                    </div>
                    <Textarea
                      value={promptResponse}
                      onChange={(e) => setPromptResponse(e.target.value)}
                      placeholder="Type your response..."
                      rows={3}
                    />
                    {promptError && (
                      <p className="text-sm text-destructive">{promptError}</p>
                    )}
                    <Button
                      onClick={() => handlePromptRespond(prompt.id)}
                      disabled={responding || !promptResponse.trim()}
                    >
                      {responding ? 'Submitting...' : 'Submit Response'}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Secondary transitions at bottom of Overview */}
          {secondaryTransitions.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-xs text-muted-foreground mb-2">Other actions:</p>
              <div className="flex gap-2 flex-wrap">
                {secondaryTransitions.map((t) => (
                  <Button
                    key={t.to}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTransition(t.to)}
                    disabled={transitioning !== null}
                  >
                    {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeline">
          <DebuggerPanel entries={debugTimeline ?? []} />
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
              <CardTitle>Agent Runs</CardTitle>
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

        <TabsContent value="pipeline">
          {pipeline ? (
            <PipelineVertical
              pipeline={pipeline}
              currentStatus={task.status}
              transitionEntries={(debugTimeline ?? []).filter((e) => e.source === 'transition')}
            />
          ) : (
            <Card className="mt-4">
              <CardContent className="py-4">
                <p className="text-sm text-muted-foreground">Pipeline not loaded.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Task</DialogTitle>
          </DialogHeader>
          {hasRunningAgent ? (
            <p className="text-sm text-amber-600 py-4">
              Stop the running agent before deleting this task.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              Are you sure you want to delete &quot;{task.title}&quot;? This action cannot be undone.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting || hasRunningAgent}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Determine which transition targets are "primary" for the status action bar */
function getPrimaryTransitionTargets(status: string, isStuck: boolean): Set<string> {
  switch (status) {
    case 'open':
      return new Set(['planning', 'implementing']);
    case 'planning':
      return isStuck ? new Set(['open']) : new Set();
    case 'implementing':
      return isStuck ? new Set(['open', 'plan_review']) : new Set();
    case 'plan_review':
      return new Set(['implementing']);
    case 'pr_review':
      return new Set(['done', 'implementing']);
    case 'needs_info':
      return new Set();
    case 'done':
      return new Set();
    default:
      return new Set(); // Fallback: handled by isAgentPipeline=false path
  }
}

/** Render prompt questions from payload */
function renderPromptQuestions(payload: Record<string, unknown>) {
  if (Array.isArray(payload.questions)) {
    return (
      <ul className="list-disc ml-4 space-y-1">
        {payload.questions.map((q: unknown, i: number) => (
          <li key={i}>{String(q)}</li>
        ))}
      </ul>
    );
  }
  if (typeof payload.question === 'string') {
    return <p>{payload.question}</p>;
  }
  return <p>The agent needs additional information to proceed.</p>;
}

/** Status Action Bar component */
function StatusActionBar({
  task,
  isAgentPipeline,
  hasRunningAgent,
  activeRun,
  lastRun,
  isStuck,
  isFinalizing,
  primaryTransitions,
  transitioning,
  stoppingAgent,
  onTransition,
  onStopAgent,
  onNavigateToRun,
}: {
  task: { status: string; prLink?: string | null };
  isAgentPipeline: boolean;
  hasRunningAgent: boolean;
  activeRun: AgentRun | null;
  lastRun: AgentRun | null;
  isStuck: boolean;
  isFinalizing: boolean;
  primaryTransitions: Transition[];
  transitioning: string | null;
  stoppingAgent: boolean;
  onTransition: (toStatus: string) => void;
  onStopAgent: () => void;
  onNavigateToRun: (runId: string) => void;
}) {
  if (!isAgentPipeline) {
    // Fallback: render all transitions as standard buttons
    if (!primaryTransitions.length) return null;
    return (
      <div className="mb-4 rounded-md border px-4 py-3 flex items-center gap-3 flex-wrap">
        {primaryTransitions.map((t) => (
          <Button
            key={t.to}
            onClick={() => onTransition(t.to)}
            disabled={transitioning !== null}
          >
            {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
          </Button>
        ))}
      </div>
    );
  }

  const status = task.status;

  // Open: show primary forward transitions
  if (status === 'open') {
    if (!primaryTransitions.length) return null;
    return (
      <div className="mb-4 rounded-md border px-4 py-3 flex items-center gap-3 flex-wrap">
        {primaryTransitions.map((t) => (
          <Button
            key={t.to}
            onClick={() => onTransition(t.to)}
            disabled={transitioning !== null}
          >
            {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
          </Button>
        ))}
      </div>
    );
  }

  // Planning / Implementing with running agent
  if ((status === 'planning' || status === 'implementing') && hasRunningAgent && activeRun) {
    return (
      <div className="mb-4 rounded-md border px-4 py-3 flex items-center gap-3" style={{ borderColor: '#22c55e' }}>
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
        </span>
        <span className="text-sm">
          Agent running: {activeRun.mode} / {activeRun.agentType}
        </span>
        <button
          className="text-sm text-blue-500 hover:underline ml-2"
          onClick={() => onNavigateToRun(activeRun.id)}
        >
          View Output &rarr;
        </button>
        <div className="ml-auto">
          <Button variant="destructive" size="sm" onClick={onStopAgent} disabled={stoppingAgent}>
            {stoppingAgent ? 'Stopping...' : 'Stop Agent'}
          </Button>
        </div>
      </div>
    );
  }

  // Planning / Implementing — agent just finished, post-completion work in progress
  if ((status === 'planning' || status === 'implementing') && isFinalizing) {
    return (
      <div className="mb-4 rounded-md border px-4 py-3 flex items-center gap-3" style={{ borderColor: '#3b82f6' }}>
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
        </span>
        <span className="text-sm">
          Finalizing — pushing branch and creating PR...
        </span>
        {lastRun && (
          <button
            className="text-sm text-blue-500 hover:underline ml-2"
            onClick={() => onNavigateToRun(lastRun.id)}
          >
            View Output &rarr;
          </button>
        )}
      </div>
    );
  }

  // Planning / Implementing stuck (failed or no agent)
  if ((status === 'planning' || status === 'implementing') && isStuck) {
    return (
      <div className="mb-4 rounded-md px-4 py-3 flex items-center gap-3 flex-wrap" style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5' }}>
        <span className="text-sm font-medium" style={{ color: '#dc2626' }}>
          Agent failed or not running
        </span>
        {lastRun && (
          <button
            className="text-sm text-blue-500 hover:underline"
            onClick={() => onNavigateToRun(lastRun.id)}
          >
            View Last Run
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          {primaryTransitions.map((t) => (
            <Button
              key={t.to}
              variant="outline"
              size="sm"
              onClick={() => onTransition(t.to)}
              disabled={transitioning !== null}
            >
              {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  // Plan Review
  if (status === 'plan_review') {
    return (
      <div className="mb-4 rounded-md border px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm">Review the plan, then:</span>
        {primaryTransitions.map((t) => (
          <Button
            key={t.to}
            onClick={() => onTransition(t.to)}
            disabled={transitioning !== null}
          >
            {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
          </Button>
        ))}
      </div>
    );
  }

  // PR Review
  if (status === 'pr_review') {
    return (
      <div className="mb-4 rounded-md border px-4 py-3 flex items-center gap-3 flex-wrap">
        {task.prLink ? (
          <span className="text-sm font-mono">{task.prLink}</span>
        ) : (
          <span className="text-sm text-muted-foreground">PR not yet available</span>
        )}
        {primaryTransitions.map((t) => (
          <Button
            key={t.to}
            variant={t.to === 'done' ? 'default' : 'outline'}
            onClick={() => onTransition(t.to)}
            disabled={transitioning !== null}
          >
            {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
          </Button>
        ))}
      </div>
    );
  }

  // Needs Info
  if (status === 'needs_info') {
    return (
      <div className="mb-4 rounded-md px-4 py-3 flex items-center gap-2" style={{ backgroundColor: '#fffbeb', border: '1px solid #fbbf24' }}>
        <span className="text-sm font-medium" style={{ color: '#d97706' }}>
          Agent needs more information
        </span>
        <span className="text-xs text-muted-foreground">— respond below</span>
      </div>
    );
  }

  // Done
  if (status === 'done') {
    return (
      <div className="mb-4 rounded-md px-4 py-3 flex items-center gap-2" style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac' }}>
        <span style={{ color: '#16a34a' }}>&#10003;</span>
        <span className="text-sm font-medium" style={{ color: '#16a34a' }}>Task complete</span>
      </div>
    );
  }

  return null;
}

const SOURCE_COLORS: Record<string, string> = {
  event: '#6b7280',
  activity: '#3b82f6',
  transition: '#8b5cf6',
  agent: '#22c55e',
  phase: '#06b6d4',
  artifact: '#f97316',
  prompt: '#f59e0b',
  git: '#e44d26',
  github: '#a855f7',
};

const SEVERITY_COLORS: Record<string, string> = {
  debug: '#9ca3af',
  info: '#3b82f6',
  warning: '#f59e0b',
  error: '#ef4444',
};

const ALL_SOURCES = ['event', 'activity', 'transition', 'agent', 'phase', 'artifact', 'prompt', 'git', 'github'] as const;
const ALL_SEVERITIES = ['debug', 'info', 'warning', 'error'] as const;

function formatTime(ts: number): string {
  if (ts === 0) return '--:--:--.---';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function DebuggerPanel({ entries }: { entries: DebugTimelineEntry[] }) {
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set(ALL_SOURCES));
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set(ALL_SEVERITIES));
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [sortNewest, setSortNewest] = useState(true);
  const [copied, setCopied] = useState(false);

  const toggleFilter = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  const filtered = entries.filter(
    (e) => sourceFilter.has(e.source) && severityFilter.has(e.severity)
  );

  const sorted = sortNewest
    ? filtered
    : [...filtered].reverse();

  const handleCopyAll = () => {
    const text = sorted.map((e) => {
      const time = formatTime(e.timestamp);
      const line = `${time} [${e.source}] [${e.severity}] ${e.title}`;
      if (e.data) return `${line}\n${JSON.stringify(e.data, null, 2)}`;
      return line;
    }).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader className="py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Timeline</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortNewest((v) => !v)}
          >
            {sortNewest ? 'Newest first' : 'Oldest first'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyAll}
            disabled={sorted.length === 0}
          >
            {copied ? 'Copied!' : 'Copy All'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filter bar */}
        <div className="flex flex-wrap gap-1 mb-3">
          {ALL_SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => toggleFilter(sourceFilter, s, setSourceFilter)}
              className="px-2 py-0.5 rounded text-xs font-medium border transition-opacity"
              style={{
                borderColor: SOURCE_COLORS[s],
                color: sourceFilter.has(s) ? '#fff' : SOURCE_COLORS[s],
                backgroundColor: sourceFilter.has(s) ? SOURCE_COLORS[s] : 'transparent',
                opacity: sourceFilter.has(s) ? 1 : 0.5,
              }}
            >
              {s}
            </button>
          ))}
          <span className="mx-1 border-l" />
          {ALL_SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => toggleFilter(severityFilter, s, setSeverityFilter)}
              className="px-2 py-0.5 rounded text-xs font-medium border transition-opacity"
              style={{
                borderColor: SEVERITY_COLORS[s],
                color: severityFilter.has(s) ? '#fff' : SEVERITY_COLORS[s],
                backgroundColor: severityFilter.has(s) ? SEVERITY_COLORS[s] : 'transparent',
                opacity: severityFilter.has(s) ? 1 : 0.5,
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Timeline */}
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries match the current filters.</p>
        ) : (
          <div className="space-y-0.5 max-h-[600px] overflow-y-auto">
            {sorted.map((entry) => {
              const stableIdx = entries.indexOf(entry);
              const expanded = expandedIds.has(stableIdx);
              return (
                <div key={stableIdx}>
                  <div
                    className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-accent/50 cursor-pointer"
                    onClick={() => {
                      if (!entry.data) return;
                      const next = new Set(expandedIds);
                      if (next.has(stableIdx)) next.delete(stableIdx); else next.add(stableIdx);
                      setExpandedIds(next);
                    }}
                  >
                    <span className="font-mono text-muted-foreground shrink-0 w-[90px]">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span
                      className="px-1.5 py-0 rounded text-[10px] font-semibold shrink-0"
                      style={{ backgroundColor: SOURCE_COLORS[entry.source] ?? '#6b7280', color: '#fff' }}
                    >
                      {entry.source}
                    </span>
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: SEVERITY_COLORS[entry.severity] ?? '#9ca3af' }}
                    />
                    <span className="truncate">{entry.title}</span>
                    {entry.data && (
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {expanded ? '\u25BC' : '\u25B6'}
                      </span>
                    )}
                  </div>
                  {expanded && entry.data && (
                    <pre className="text-[11px] bg-muted p-2 rounded ml-[98px] mr-2 mb-1 overflow-x-auto max-h-[300px] overflow-y-auto">
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Compute the happy (default forward) path through a pipeline */
function computeHappyPath(pipeline: import('../../shared/types').Pipeline): string[] {
  const { statuses, transitions } = pipeline;
  if (statuses.length === 0) return [];

  const statusIndex = new Map(statuses.map((s, i) => [s.name, i]));
  const path: string[] = [statuses[0].name];
  const visited = new Set<string>(path);

  while (true) {
    const current = path[path.length - 1];
    const currentDef = statuses.find((s) => s.name === current);
    if (currentDef?.isFinal) break;

    // Find transitions from current to an unvisited status, pick lowest-index target
    const candidates = transitions
      .filter((t) => t.from === current && !visited.has(t.to))
      .sort((a, b) => (statusIndex.get(a.to) ?? 999) - (statusIndex.get(b.to) ?? 999));

    if (candidates.length === 0) break;
    const next = candidates[0].to;
    path.push(next);
    visited.add(next);
  }
  return path;
}

/** Project forward from a status to the final status */
function projectForward(
  from: string,
  pipeline: import('../../shared/types').Pipeline,
  alreadyVisited: Set<string>,
): string[] {
  const { statuses, transitions } = pipeline;
  const statusIndex = new Map(statuses.map((s, i) => [s.name, i]));
  const path: string[] = [];
  const visited = new Set(alreadyVisited);
  let current = from;

  while (true) {
    const currentDef = statuses.find((s) => s.name === current);
    if (currentDef?.isFinal) break;

    const candidates = transitions
      .filter((t) => t.from === current && !visited.has(t.to))
      .sort((a, b) => (statusIndex.get(a.to) ?? 999) - (statusIndex.get(b.to) ?? 999));

    if (candidates.length === 0) break;
    const next = candidates[0].to;
    path.push(next);
    visited.add(next);
    current = next;
  }
  return path;
}

/** Pipeline progress visualization */
function PipelineProgress({
  pipeline,
  currentStatus,
  transitionEntries,
}: {
  pipeline: import('../../shared/types').Pipeline;
  currentStatus: string;
  transitionEntries: DebugTimelineEntry[];
}) {
  const statusLabelMap = new Map(pipeline.statuses.map((s) => [s.name, s.label]));

  // Extract visited statuses from transition entries
  const sortedTransitions = [...transitionEntries].sort((a, b) => a.timestamp - b.timestamp);
  const visitedStatuses: string[] = [];
  for (const entry of sortedTransitions) {
    const from = entry.data?.fromStatus as string | undefined;
    const to = entry.data?.toStatus as string | undefined;
    if (from && visitedStatuses.length === 0) visitedStatuses.push(from);
    if (from && visitedStatuses[visitedStatuses.length - 1] !== from) visitedStatuses.push(from);
    if (to) visitedStatuses.push(to);
  }

  // Compute display path
  let displayPath: string[];
  let currentIndex: number;

  if (visitedStatuses.length === 0) {
    // No transitions yet — show happy path, current status is active
    displayPath = computeHappyPath(pipeline);
    currentIndex = displayPath.indexOf(currentStatus);
    if (currentIndex === -1) {
      displayPath = [currentStatus, ...computeHappyPath(pipeline).filter((s) => s !== currentStatus)];
      currentIndex = 0;
    }
  } else {
    // Dedup visited list preserving order
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const s of visitedStatuses) {
      if (!seen.has(s)) { seen.add(s); deduped.push(s); }
    }
    // Ensure current status is included
    if (!seen.has(currentStatus)) {
      deduped.push(currentStatus);
      seen.add(currentStatus);
    }
    // Project forward from current
    const future = projectForward(currentStatus, pipeline, seen);
    displayPath = [...deduped, ...future];
    currentIndex = displayPath.indexOf(currentStatus);
  }

  return (
    <Card className="mt-4">
      <CardContent className="py-6">
        <div className="flex flex-wrap items-center gap-y-4">
          {displayPath.map((statusName, i) => {
            const isCompleted = i < currentIndex;
            const isCurrent = i === currentIndex;
            const isFuture = i > currentIndex;
            const label = statusLabelMap.get(statusName) ?? statusName;

            return (
              <React.Fragment key={statusName}>
                {/* Connector line */}
                {i > 0 && (
                  <div
                    className="h-0.5 flex-shrink-0"
                    style={{
                      width: 32,
                      backgroundColor: i <= currentIndex ? '#22c55e' : '#d1d5db',
                    }}
                  />
                )}
                {/* Node */}
                <div className="flex flex-col items-center gap-1.5" style={{ minWidth: 64 }}>
                  <div
                    className="relative flex items-center justify-center rounded-full"
                    style={{
                      width: 28,
                      height: 28,
                      backgroundColor: isCompleted ? '#22c55e' : isCurrent ? '#3b82f6' : '#d1d5db',
                    }}
                  >
                    {isCompleted && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {isCurrent && (
                      <>
                        <span
                          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                          style={{ backgroundColor: '#3b82f6' }}
                        />
                        <span
                          className="relative inline-flex rounded-full"
                          style={{ width: 10, height: 10, backgroundColor: '#fff' }}
                        />
                      </>
                    )}
                    {isFuture && (
                      <span
                        className="rounded-full"
                        style={{ width: 10, height: 10, backgroundColor: '#9ca3af' }}
                      />
                    )}
                  </div>
                  <span
                    className="text-xs font-medium text-center"
                    style={{
                      color: isCompleted ? '#16a34a' : isCurrent ? '#2563eb' : '#9ca3af',
                    }}
                  >
                    {label}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/** Build a map of status details from transition entries */
function buildStatusDetailsMap(
  transitionEntries: DebugTimelineEntry[],
): Map<string, { timestamp: number; trigger?: string; guardResults?: unknown; duration?: number }> {
  const sorted = [...transitionEntries].sort((a, b) => a.timestamp - b.timestamp);
  const map = new Map<string, { timestamp: number; trigger?: string; guardResults?: unknown; duration?: number }>();

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const toStatus = entry.data?.toStatus as string | undefined;
    if (!toStatus) continue;

    const nextTimestamp = i + 1 < sorted.length ? sorted[i + 1].timestamp : undefined;
    const duration = nextTimestamp != null ? nextTimestamp - entry.timestamp : undefined;

    map.set(toStatus, {
      timestamp: entry.timestamp,
      trigger: entry.data?.trigger as string | undefined,
      guardResults: entry.data?.guardResults,
      duration,
    });
  }

  return map;
}

/** Format a duration in ms to a human-readable string */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

/** Vertical pipeline with collapsible step details */
function PipelineVertical({
  pipeline,
  currentStatus,
  transitionEntries,
}: {
  pipeline: import('../../shared/types').Pipeline;
  currentStatus: string;
  transitionEntries: DebugTimelineEntry[];
}) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const statusLabelMap = new Map(pipeline.statuses.map((s) => [s.name, s.label]));
  const statusDetailsMap = buildStatusDetailsMap(transitionEntries);

  // Compute display path (same logic as PipelineProgress)
  const sortedTransitions = [...transitionEntries].sort((a, b) => a.timestamp - b.timestamp);
  const visitedStatuses: string[] = [];
  for (const entry of sortedTransitions) {
    const from = entry.data?.fromStatus as string | undefined;
    const to = entry.data?.toStatus as string | undefined;
    if (from && visitedStatuses.length === 0) visitedStatuses.push(from);
    if (from && visitedStatuses[visitedStatuses.length - 1] !== from) visitedStatuses.push(from);
    if (to) visitedStatuses.push(to);
  }

  let displayPath: string[];
  let currentIndex: number;

  if (visitedStatuses.length === 0) {
    displayPath = computeHappyPath(pipeline);
    currentIndex = displayPath.indexOf(currentStatus);
    if (currentIndex === -1) {
      displayPath = [currentStatus, ...computeHappyPath(pipeline).filter((s) => s !== currentStatus)];
      currentIndex = 0;
    }
  } else {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const s of visitedStatuses) {
      if (!seen.has(s)) { seen.add(s); deduped.push(s); }
    }
    if (!seen.has(currentStatus)) {
      deduped.push(currentStatus);
      seen.add(currentStatus);
    }
    const future = projectForward(currentStatus, pipeline, seen);
    displayPath = [...deduped, ...future];
    currentIndex = displayPath.indexOf(currentStatus);
  }

  const toggleStep = (idx: number) => {
    const next = new Set(expandedSteps);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setExpandedSteps(next);
  };

  return (
    <Card className="mt-4">
      <CardContent className="py-6">
        <div className="flex flex-col">
          {displayPath.map((statusName, i) => {
            const isCompleted = i < currentIndex;
            const isCurrent = i === currentIndex;
            const isFuture = i > currentIndex;
            const label = statusLabelMap.get(statusName) ?? statusName;
            const details = statusDetailsMap.get(statusName);
            const hasDetails = isCompleted || (isCurrent && details);
            const expanded = expandedSteps.has(i);

            // For current step, compute live duration
            const currentDuration = isCurrent && details
              ? Date.now() - details.timestamp
              : undefined;

            return (
              <div key={statusName} className="flex">
                {/* Left column: node + connector */}
                <div className="flex flex-col items-center mr-4" style={{ width: 28 }}>
                  {/* Node */}
                  <div
                    className="relative flex items-center justify-center rounded-full flex-shrink-0"
                    style={{
                      width: 28,
                      height: 28,
                      backgroundColor: isCompleted ? '#22c55e' : isCurrent ? '#3b82f6' : '#d1d5db',
                    }}
                  >
                    {isCompleted && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {isCurrent && (
                      <>
                        <span
                          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                          style={{ backgroundColor: '#3b82f6' }}
                        />
                        <span
                          className="relative inline-flex rounded-full"
                          style={{ width: 10, height: 10, backgroundColor: '#fff' }}
                        />
                      </>
                    )}
                    {isFuture && (
                      <span
                        className="rounded-full"
                        style={{ width: 10, height: 10, backgroundColor: '#9ca3af' }}
                      />
                    )}
                  </div>
                  {/* Connector line */}
                  {i < displayPath.length - 1 && (
                    <div
                      className="flex-1"
                      style={{
                        width: 2,
                        minHeight: expanded ? 8 : 24,
                        backgroundColor: i < currentIndex ? '#22c55e' : '#d1d5db',
                      }}
                    />
                  )}
                </div>

                {/* Right column: label + details */}
                <div className={`flex-1 ${i < displayPath.length - 1 ? 'pb-2' : ''}`}>
                  <div
                    className={`flex items-center gap-2 py-1 rounded -mt-0.5 ${hasDetails ? 'cursor-pointer hover:bg-accent/50' : ''}`}
                    style={{ minHeight: 28 }}
                    onClick={() => hasDetails && toggleStep(i)}
                  >
                    <span
                      className="text-sm font-medium"
                      style={{
                        color: isCompleted ? '#16a34a' : isCurrent ? '#2563eb' : '#9ca3af',
                      }}
                    >
                      {label}
                    </span>
                    {hasDetails && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {expanded ? '\u25BC' : '\u25B6'}
                      </span>
                    )}
                  </div>

                  {/* Expanded details */}
                  {expanded && hasDetails && (
                    <div className="ml-1 mt-1 mb-2 pl-3 border-l-2 text-xs space-y-1.5" style={{ borderColor: isCompleted ? '#22c55e' : '#3b82f6' }}>
                      {isCompleted && details && (
                        <>
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Arrived at:</span>
                            <span className="font-mono">{formatTime(details.timestamp)}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Duration:</span>
                            <span>{details.duration != null ? formatDuration(details.duration) : 'N/A'}</span>
                          </div>
                          {details.trigger && (
                            <div className="flex gap-2 items-center">
                              <span className="text-muted-foreground">Trigger:</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{details.trigger}</Badge>
                            </div>
                          )}
                          {details.guardResults && typeof details.guardResults === 'object' && Object.keys(details.guardResults as object).length > 0 && (
                            <div>
                              <span className="text-muted-foreground">Guard results:</span>
                              <pre className="text-[11px] bg-muted p-2 rounded mt-1 overflow-x-auto max-h-[200px] overflow-y-auto">
                                {JSON.stringify(details.guardResults, null, 2)}
                              </pre>
                            </div>
                          )}
                        </>
                      )}
                      {isCurrent && details && (
                        <>
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Active since:</span>
                            <span className="font-mono">{formatTime(details.timestamp)}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Duration so far:</span>
                            <span>{currentDuration != null ? formatDuration(currentDuration) : 'N/A'}</span>
                          </div>
                          {details.trigger && (
                            <div className="flex gap-2 items-center">
                              <span className="text-muted-foreground">Trigger:</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{details.trigger}</Badge>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
