import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../components/ui/select';
import { useTask, useTasks } from '../hooks/useTasks';
import { usePipeline } from '../hooks/usePipelines';
import { useFeatures } from '../hooks/useFeatures';
import { PipelineBadge } from '../components/pipeline/PipelineBadge';
import { GitTab } from '../components/tasks/GitTab';
import { useIpc } from '@template/renderer/hooks/useIpc';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Task, Transition, TaskArtifact, AgentRun, TaskUpdateInput, PendingPrompt,
  DebugTimelineEntry, Worktree, TaskContextEntry, Subtask, SubtaskStatus, PlanComment,
} from '../../shared/types';
import { usePipelineStatusMeta, type StatusMeta } from '../hooks/usePipelineStatusMeta';

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { task, loading, error, refetch } = useTask(id!);
  const { pipeline } = usePipeline(task?.pipelineId);
  const statusMeta = usePipelineStatusMeta(task, pipeline);
  const { features } = useFeatures(task ? { projectId: task.projectId } : undefined);

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

  const { data: worktree } = useIpc<Worktree | null>(
    () => id ? window.api.tasks.worktree(id) : Promise.resolve(null),
    [id, task?.status]
  );

  const { data: contextEntries, refetch: refetchContext } = useIpc<TaskContextEntry[]>(
    () => id ? window.api.tasks.contextEntries(id) : Promise.resolve([]),
    [id]
  );

  // Derived agent state
  const isAgentPipeline = pipeline?.statuses.some((s) => s.category === 'agent_running') ?? false;
  const hasRunningAgent = agentRuns?.some((r) => r.status === 'running') ?? false;
  const activeRun = agentRuns?.find((r) => r.status === 'running') ?? null;
  const lastRun = agentRuns?.[0] ?? null;
  const isAgentPhase = statusMeta.isAgentRunning;
  // After agent completes, post-completion work (git push, PR creation) may take
  // several seconds before transitioning the task. Don't show "stuck" during this window.
  const isFinalizing = isAgentPhase && !hasRunningAgent && agentRuns !== null
    && lastRun?.status === 'completed' && lastRun.completedAt != null
    && (Date.now() - lastRun.completedAt) < 30000;
  const isStuck = isAgentPhase && !hasRunningAgent && agentRuns !== null && !isFinalizing;

  // Poll while agent is running, needs_info, finalizing, stuck, or waiting for PR
  const awaitingPr = statusMeta.isHumanReview && !task?.prLink;
  const shouldPoll = hasRunningAgent || statusMeta.isWaitingForInput || isFinalizing || isStuck || awaitingPr;

  useEffect(() => {
    if (!shouldPoll) return;
    const interval = setInterval(() => {
      refetchAgentRuns();
      refetch();
      refetchTransitions();
      refetchPrompts();
      refetchDebug();
      refetchContext();
    }, 3000);
    return () => clearInterval(interval);
  }, [shouldPoll, refetchAgentRuns, refetch, refetchTransitions, refetchPrompts, refetchDebug, refetchContext]);

  // Completion edge: full refresh when agent finishes
  const prevHasRunning = useRef(hasRunningAgent);
  useEffect(() => {
    if (prevHasRunning.current && !hasRunningAgent) {
      refetch(); refetchTransitions(); refetchAgentRuns(); refetchPrompts(); refetchDebug(); refetchContext();
    }
    prevHasRunning.current = hasRunningAgent;
  }, [hasRunningAgent, refetch, refetchTransitions, refetchAgentRuns, refetchPrompts, refetchDebug, refetchContext]);

  const initialTab = task?.status === 'plan_review' ? 'plan' : 'overview';
  const [tab, setTab] = useState(initialTab);

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
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [stoppingAgent, setStoppingAgent] = useState(false);

  // Prompt response state — per-prompt to avoid cross-prompt interference
  const [promptResponses, setPromptResponses] = useState<Record<string, string>>({});
  const [responding, setResponding] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const getPromptResponse = (promptId: string) => promptResponses[promptId] ?? '';
  const setPromptResponse = (promptId: string, value: string) =>
    setPromptResponses(prev => ({ ...prev, [promptId]: value }));

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
        featureId: task.featureId,
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
      const result = await window.api.prompts.respond(promptId, { answer: getPromptResponse(promptId) });
      if (!result) {
        setPromptError('This prompt has already been answered.');
      } else {
        setPromptResponse(promptId, '');
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

  const handleReset = async () => {
    if (!id) return;
    setResetting(true);
    try {
      await window.api.tasks.reset(id);
      setResetOpen(false);
      await refetch();
      await refetchTransitions();
      await refetchAgentRuns();
      await refetchPrompts();
      await refetchDebug();
      await refetchContext();
    } finally {
      setResetting(false);
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
  // vs "secondary" (shown at bottom of overview).
  // Uses pipeline status categories instead of hardcoded status names.
  const hasCategories = statusMeta.category !== undefined;
  const allTransitions = transitions ?? [];
  let primaryTransitions: Transition[];
  let secondaryTransitions: Transition[];
  if (!hasCategories) {
    // Non-categorized pipelines: all transitions in bar
    primaryTransitions = allTransitions;
    secondaryTransitions = [];
  } else if (statusMeta.isReady || statusMeta.isHumanReview) {
    // Ready / human review: all transitions are primary actions
    primaryTransitions = allTransitions;
    secondaryTransitions = [];
  } else if (statusMeta.isAgentRunning) {
    // Agent running: only show cancel/recovery when stuck
    primaryTransitions = isStuck ? allTransitions : [];
    secondaryTransitions = isStuck ? [] : allTransitions;
  } else {
    // Terminal / waiting_for_input: no primary actions
    primaryTransitions = [];
    secondaryTransitions = allTransitions;
  }

  return (
    <div className="p-8">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(-1 as any)}>
        &larr; Back
      </Button>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <PipelineBadge status={task.status} pipeline={pipeline} />
          <div>
            <h1 className="text-3xl font-bold">{task.title}</h1>
            {worktree && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                Worktree: {worktree.branch}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDuplicate} disabled={duplicating}>
            {duplicating ? 'Duplicating...' : 'Duplicate'}
          </Button>
          <Button variant="outline" onClick={openEdit}>Edit</Button>
          <Button variant="outline" onClick={() => setResetOpen(true)} disabled={hasRunningAgent}>Reset</Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Delete</Button>
        </div>
      </div>

      {/* Inline compact pipeline progress bar */}
      {pipeline && (
        <PipelineProgress
          pipeline={pipeline}
          currentStatus={task.status}
          transitionEntries={(debugTimeline ?? []).filter((e) => e.source === 'transition')}
          agentState={hasRunningAgent ? 'running' : isStuck ? 'failed' : 'idle'}
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
          statusMeta={statusMeta}
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
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="agents">Agent Runs</TabsTrigger>
          <TabsTrigger value="context">Context</TabsTrigger>
          <TabsTrigger value="git">Git</TabsTrigger>
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

                {task.featureId && (
                  <>
                    <span className="text-sm text-muted-foreground">Feature</span>
                    <span
                      className="text-sm text-blue-500 hover:underline cursor-pointer"
                      onClick={() => navigate(`/features/${task.featureId}`)}
                    >
                      {features.find((f) => f.id === task.featureId)?.title ?? task.featureId}
                    </span>
                  </>
                )}

                {task.prLink && (
                  <>
                    <span className="text-sm text-muted-foreground">PR</span>
                    <a
                      href={task.prLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-500 hover:underline break-all"
                    >
                      {task.prLink}
                    </a>
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

          {/* Subtasks */}
          <SubtasksSection taskId={id!} subtasks={task.subtasks} onUpdate={refetch} />

          {/* Dependencies */}
          <DependenciesSection taskId={id!} projectId={task.projectId} />

          {/* Pending Prompt UI — show whenever there are pending prompts, not just in needs_info */}
          {pendingPrompts && pendingPrompts.some(p => p.status === 'pending') && (
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
                      value={getPromptResponse(prompt.id)}
                      onChange={(e) => setPromptResponse(prompt.id, e.target.value)}
                      placeholder="Type your response..."
                      rows={3}
                    />
                    {promptError && (
                      <p className="text-sm text-destructive">{promptError}</p>
                    )}
                    <Button
                      onClick={() => handlePromptRespond(prompt.id)}
                      disabled={responding || !getPromptResponse(prompt.id).trim()}
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

        <TabsContent value="plan">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Plan</CardTitle>
            </CardHeader>
            <CardContent>
              {task.plan ? (
                <PlanMarkdown content={task.plan} />
              ) : (
                <p className="text-sm text-muted-foreground">No plan yet. A plan will appear here after the planning agent completes.</p>
              )}
            </CardContent>
          </Card>

          {/* Plan Review Actions */}
          {task.status === 'plan_review' && (
            <PlanReviewSection
              taskId={id!}
              planComments={task.planComments}
              transitions={transitions ?? []}
              transitioning={transitioning}
              onTransition={handleTransition}
              onRefetch={refetch}
            />
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
                    <ArtifactCard key={artifact.id} artifact={artifact} />
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

        <TabsContent value="context">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Task Context</CardTitle>
            </CardHeader>
            <CardContent>
              {!contextEntries || contextEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No context entries yet. Entries are added as agents complete their work.</p>
              ) : (
                <div className="space-y-3">
                  {contextEntries.map((entry) => (
                    <ContextEntryCard key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="git">
          <GitTab taskId={id!} />
        </TabsContent>

        <TabsContent value="pipeline">
          {pipeline ? (
            <PipelineVertical
              pipeline={pipeline}
              currentStatus={task.status}
              transitionEntries={(debugTimeline ?? []).filter((e) => e.source === 'transition')}
              agentState={hasRunningAgent ? 'running' : isStuck ? 'failed' : 'idle'}
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
              <Textarea
                rows={3}
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
            {features.length > 0 && (
              <div className="space-y-2">
                <Label>Feature</Label>
                <Select
                  value={editForm.featureId ?? '__none__'}
                  onValueChange={(v) => setEditForm({ ...editForm, featureId: v === '__none__' ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No feature" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No feature</SelectItem>
                    {features.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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

      {/* Reset Confirmation Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Task</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              This will clear all agent-generated data for &quot;{task.title}&quot; and reset the status to the pipeline&apos;s initial state.
            </p>
            <div className="text-sm space-y-1">
              <p className="font-medium">Cleared:</p>
              <p className="text-muted-foreground">Plan, subtasks, PR link, branch, agent runs, events, timeline, artifacts, worktree</p>
            </div>
            <div className="text-sm space-y-1">
              <p className="font-medium">Preserved:</p>
              <p className="text-muted-foreground">Title, description, priority, tags, assignee, dependencies</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReset} disabled={resetting}>
              {resetting ? 'Resetting...' : 'Reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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

/** Plan Review Section — comment history, new comment, approve/request changes */
function PlanReviewSection({
  taskId,
  planComments,
  transitions,
  transitioning,
  onTransition,
  onRefetch,
}: {
  taskId: string;
  planComments: PlanComment[];
  transitions: Transition[];
  transitioning: string | null;
  onTransition: (toStatus: string) => Promise<void> | void;
  onRefetch: () => Promise<void> | void;
}) {
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);

  const approveTransition = transitions.find((t) => t.to === 'implementing');
  const reviseTransition = transitions.find((t) => t.to === 'planning');

  const handleAction = async (toStatus: string) => {
    setSaving(true);
    try {
      // Save comment if provided
      if (newComment.trim()) {
        const comment: PlanComment = {
          author: 'admin',
          content: newComment.trim(),
          createdAt: Date.now(),
        };
        await window.api.tasks.update(taskId, {
          planComments: [...(planComments ?? []), comment],
        });
        setNewComment('');
        await onRefetch();
      }
      // Trigger transition — await to keep buttons disabled until complete
      await onTransition(toStatus);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-4 border-blue-400">
      <CardHeader className="py-3">
        <CardTitle className="text-base">Plan Review</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Comment history */}
        {planComments && planComments.length > 0 && (
          <div className="space-y-2 mb-4">
            {planComments.map((comment, i) => (
              <div key={i} className="rounded-md bg-muted px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold">{comment.author}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(comment.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
              </div>
            ))}
          </div>
        )}

        {/* New comment textarea */}
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add feedback for the planning agent..."
          rows={3}
          className="mb-3"
        />

        {/* Action buttons */}
        <div className="flex gap-2">
          {approveTransition && (
            <Button
              onClick={() => handleAction(approveTransition.to)}
              disabled={saving || transitioning !== null}
            >
              {transitioning === approveTransition.to ? 'Approving...' : 'Approve & Implement'}
            </Button>
          )}
          {reviseTransition && (
            <Button
              variant="outline"
              onClick={() => handleAction(reviseTransition.to)}
              disabled={saving || transitioning !== null || !newComment.trim()}
            >
              {transitioning === reviseTransition.to ? 'Requesting...' : 'Request Plan Changes'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Subtasks Section */
function SubtasksSection({
  taskId,
  subtasks,
  onUpdate,
}: {
  taskId: string;
  subtasks: Subtask[];
  onUpdate: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const updateSubtasks = useCallback(async (updated: Subtask[]) => {
    await window.api.tasks.update(taskId, { subtasks: updated });
    onUpdate();
  }, [taskId, onUpdate]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await updateSubtasks([...subtasks, { name: newName.trim(), status: 'open' }]);
      setNewName('');
    } finally {
      setAdding(false);
    }
  };

  const cycleStatus = (index: number) => {
    const order: SubtaskStatus[] = ['open', 'in_progress', 'done'];
    const current = subtasks[index].status;
    const next = order[(order.indexOf(current) + 1) % order.length];
    const updated = subtasks.map((s, i) => (i === index ? { ...s, status: next } : s));
    updateSubtasks(updated);
  };

  const removeSubtask = (index: number) => {
    updateSubtasks(subtasks.filter((_, i) => i !== index));
  };

  const doneCount = subtasks.filter((s) => s.status === 'done').length;

  return (
    <Card className="mt-4">
      <CardHeader className="py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Subtasks
          {subtasks.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {doneCount}/{subtasks.length} done
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {subtasks.length > 0 && (
          <div className="space-y-1 mb-3">
            {subtasks.map((st, i) => (
              <div key={i} className="flex items-center gap-2 group py-1">
                <button
                  onClick={() => cycleStatus(i)}
                  className="flex items-center justify-center w-5 h-5 rounded-full border-2 shrink-0 transition-colors"
                  style={{
                    borderColor: st.status === 'done' ? '#22c55e' : st.status === 'in_progress' ? '#3b82f6' : '#d1d5db',
                    backgroundColor: st.status === 'done' ? '#22c55e' : 'transparent',
                  }}
                  title={`Status: ${st.status} (click to cycle)`}
                >
                  {st.status === 'done' && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6l2.5 2.5 4.5-4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {st.status === 'in_progress' && (
                    <span
                      className="inline-block w-2 h-2 rounded-full animate-pulse"
                      style={{ backgroundColor: '#3b82f6' }}
                    />
                  )}
                </button>
                <span
                  className="text-sm flex-1"
                  style={{
                    textDecoration: st.status === 'done' ? 'line-through' : undefined,
                    color: st.status === 'done' ? '#9ca3af' : undefined,
                  }}
                >
                  {st.name}
                </span>
                <button
                  onClick={() => removeSubtask(i)}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity text-sm px-1"
                  title="Remove subtask"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add a subtask..."
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
          />
          <Button size="sm" onClick={handleAdd} disabled={adding || !newName.trim()}>
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Dependencies Section — Blocked By + Blocks */
function DependenciesSection({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const navigate = useNavigate();

  const { data: blockedBy, refetch: refetchDeps } = useIpc<Task[]>(
    () => window.api.tasks.dependencies(taskId),
    [taskId],
  );

  const { data: blocks, refetch: refetchDependents } = useIpc<Task[]>(
    () => window.api.tasks.dependents(taskId),
    [taskId],
  );

  const { tasks: projectTasks } = useTasks({ projectId });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const blockedByIds = new Set((blockedBy ?? []).map((t) => t.id));
  const availableTasks = projectTasks.filter(
    (t) => t.id !== taskId && !blockedByIds.has(t.id),
  );

  const handleAdd = async (depTaskId: string) => {
    await window.api.tasks.addDependency(taskId, depTaskId);
    setPickerOpen(false);
    await refetchDeps();
    await refetchDependents();
  };

  const handleRemove = async (depTaskId: string) => {
    setRemoving(depTaskId);
    try {
      await window.api.tasks.removeDependency(taskId, depTaskId);
      await refetchDeps();
      await refetchDependents();
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="py-3">
        <CardTitle className="text-base">Dependencies</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Blocked By */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">Blocked By</span>
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              Add
            </Button>
          </div>
          {(!blockedBy || blockedBy.length === 0) ? (
            <p className="text-xs text-muted-foreground">No dependencies.</p>
          ) : (
            <div className="space-y-1">
              {blockedBy.map((dep) => (
                <div key={dep.id} className="flex items-center gap-2 group py-1">
                  <Badge variant="outline" className="text-[10px] shrink-0">{dep.status}</Badge>
                  <span
                    className="text-sm text-blue-500 hover:underline cursor-pointer truncate flex-1"
                    onClick={() => navigate(`/tasks/${dep.id}`)}
                  >
                    {dep.title}
                  </span>
                  <button
                    onClick={() => handleRemove(dep.id)}
                    disabled={removing === dep.id}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity text-sm px-1"
                    title="Remove dependency"
                  >
                    {removing === dep.id ? '...' : '\u00d7'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Blocks */}
        <div>
          <span className="text-sm font-medium text-muted-foreground block mb-2">Blocks</span>
          {(!blocks || blocks.length === 0) ? (
            <p className="text-xs text-muted-foreground">No tasks depend on this task.</p>
          ) : (
            <div className="space-y-1">
              {blocks.map((dep) => (
                <div key={dep.id} className="flex items-center gap-2 py-1">
                  <Badge variant="outline" className="text-[10px] shrink-0">{dep.status}</Badge>
                  <span
                    className="text-sm text-blue-500 hover:underline cursor-pointer truncate"
                    onClick={() => navigate(`/tasks/${dep.id}`)}
                  >
                    {dep.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Dependency Picker */}
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Dependency</DialogTitle>
            </DialogHeader>
            <DependencyPicker tasks={availableTasks} onSelect={handleAdd} />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** Simple searchable picker for selecting a task dependency */
function DependencyPicker({
  tasks,
  onSelect,
}: {
  tasks: Task[];
  onSelect: (taskId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = tasks.filter((t) =>
    t.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="py-2 space-y-3">
      <Input
        placeholder="Search tasks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className="max-h-60 overflow-y-auto space-y-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No matching tasks.</p>
        ) : (
          filtered.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 px-2 py-2 rounded hover:bg-accent cursor-pointer"
              onClick={() => onSelect(t.id)}
            >
              <Badge variant="outline" className="text-[10px] shrink-0">{t.status}</Badge>
              <span className="text-sm truncate">{t.title}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
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
  statusMeta,
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
  statusMeta: StatusMeta;
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

  // Ready category (open, reported, etc.): show primary forward transitions
  if (statusMeta.isReady) {
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

  // Agent running with active agent
  if (statusMeta.isAgentRunning && hasRunningAgent && activeRun) {
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

  // Agent running — agent just finished, post-completion work in progress
  if (statusMeta.isAgentRunning && isFinalizing) {
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

  // Agent running stuck (failed or no agent)
  if (statusMeta.isAgentRunning && isStuck) {
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

  // Human review (plan_review, investigation_review, pr_review, etc.)
  if (statusMeta.isHumanReview) {
    // PR review has special handling for the PR link
    if (status === 'pr_review') {
      return (
        <div className="mb-4 rounded-md border px-4 py-3 flex items-center gap-3 flex-wrap">
          {task.prLink ? (
            <a
              href={task.prLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-500 hover:underline break-all"
            >
              {task.prLink}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground animate-pulse">Creating PR...</span>
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
    // Generic human review (plan_review, investigation_review, etc.)
    return (
      <div className="mb-4 rounded-md border px-4 py-3 flex items-center gap-3 flex-wrap" style={{ borderColor: '#3b82f6' }}>
        <span className="text-sm">Review the output, then approve or request changes.</span>
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

  // Waiting for input (needs_info, etc.)
  if (statusMeta.isWaitingForInput) {
    return (
      <div className="mb-4 rounded-md px-4 py-3 flex items-center gap-2" style={{ backgroundColor: '#fffbeb', border: '1px solid #fbbf24' }}>
        <span className="text-sm font-medium" style={{ color: '#d97706' }}>
          Agent needs more information
        </span>
        <span className="text-xs text-muted-foreground">— respond below</span>
      </div>
    );
  }

  // Terminal (done, resolved, etc.)
  if (statusMeta.isTerminal) {
    return (
      <div className="mb-4 rounded-md px-4 py-3 flex items-center gap-2" style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac' }}>
        <span style={{ color: '#16a34a' }}>&#10003;</span>
        <span className="text-sm font-medium" style={{ color: '#16a34a' }}>Task complete</span>
      </div>
    );
  }

  return null;
}

/** Markdown renderer for the Plan tab with tables, code blocks, and file links */
function PlanMarkdown({ content }: { content: string }) {
  return (
    <div className="plan-markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border-collapse border border-border text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-border px-3 py-1.5 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                  {children}
                </code>
              );
            }
            const lang = className?.replace('language-', '') ?? '';
            return (
              <div className="my-3 rounded-md border overflow-hidden">
                {lang && (
                  <div className="px-3 py-1 bg-muted border-b text-xs text-muted-foreground font-mono">
                    {lang}
                  </div>
                )}
                <pre className="p-3 overflow-x-auto bg-muted/30 text-xs">
                  <code className="font-mono" {...props}>{children}</code>
                </pre>
              </div>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="text-xl font-bold mt-6 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold mt-5 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold mt-4 mb-1">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold mt-3 mb-1">{children}</h4>,
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => <ul className="list-disc ml-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ml-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-3 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: TaskArtifact }) {
  const data = artifact.data as Record<string, unknown>;

  if (artifact.type === 'pr') {
    const url = data.url as string;
    const number = data.number as number;
    return (
      <div className="flex items-center gap-3 rounded-md border px-4 py-3">
        <span className="text-lg">&#x1F517;</span>
        <div className="flex-1">
          <div className="text-sm font-medium">Pull Request #{number}</div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-500 hover:underline break-all"
          >
            {url}
          </a>
        </div>
      </div>
    );
  }

  if (artifact.type === 'branch') {
    const branch = data.branch as string;
    return (
      <div className="flex items-center gap-3 rounded-md border px-4 py-3">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground shrink-0">
          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Branch</div>
          <code className="text-xs text-muted-foreground break-all">{branch}</code>
        </div>
      </div>
    );
  }

  if (artifact.type === 'diff') {
    const diff = data.diff as string;
    const lines = diff.split('\n');
    return (
      <div className="rounded-md border overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/50 flex items-center gap-2">
          <span className="text-sm font-medium">Diff</span>
          <span className="text-xs text-muted-foreground">({lines.length} lines)</span>
        </div>
        <pre className="text-xs p-3 overflow-x-auto max-h-80 overflow-y-auto">
          {lines.map((line, i) => {
            let color = 'inherit';
            if (line.startsWith('+') && !line.startsWith('+++')) color = '#22c55e';
            else if (line.startsWith('-') && !line.startsWith('---')) color = '#ef4444';
            else if (line.startsWith('@@')) color = '#6b7280';
            return <div key={i} style={{ color }}>{line || ' '}</div>;
          })}
        </pre>
      </div>
    );
  }

  // Fallback for unknown types
  return (
    <div className="flex items-start gap-2 rounded-md border px-4 py-3">
      <Badge variant="outline">{artifact.type}</Badge>
      <pre className="text-xs bg-muted p-2 rounded flex-1 overflow-x-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

const CONTEXT_SOURCE_COLORS: Record<string, string> = {
  agent: '#3b82f6',
  reviewer: '#f59e0b',
  system: '#6b7280',
  user: '#8b5cf6',
};

function ContextEntryCard({ entry }: { entry: TaskContextEntry }) {
  const sourceColor = CONTEXT_SOURCE_COLORS[entry.source] ?? '#6b7280';
  return (
    <div className="rounded-md border px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="px-2 py-0.5 rounded text-xs font-semibold text-white"
          style={{ backgroundColor: sourceColor }}
        >
          {entry.source}
        </span>
        <span className="text-xs text-muted-foreground font-medium">
          {entry.entryType.replace(/_/g, ' ')}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(entry.createdAt).toLocaleString()}
        </span>
      </div>
      <pre className="text-sm whitespace-pre-wrap break-words bg-muted p-3 rounded max-h-[400px] overflow-y-auto">
        {entry.summary}
      </pre>
    </div>
  );
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
  worktree: '#10b981',
  context: '#14b8a6',
};

const SEVERITY_COLORS: Record<string, string> = {
  debug: '#9ca3af',
  info: '#3b82f6',
  warning: '#f59e0b',
  error: '#ef4444',
};

const ALL_SOURCES = ['event', 'activity', 'transition', 'agent', 'phase', 'artifact', 'prompt', 'git', 'github', 'context'] as const;
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

/** Compute which statuses are agentic (have agent-triggered outbound transitions) */
function computeAgenticStatuses(pipeline: import('../../shared/types').Pipeline): Set<string> {
  const agentic = new Set<string>();
  for (const t of pipeline.transitions) {
    if (t.trigger === 'agent') agentic.add(t.from);
  }
  return agentic;
}

/** Get ring box-shadow for agentic nodes */
function agenticRing(color: string): string {
  return `0 0 0 3px ${color}40`;
}

/** Compute display path with skipped steps */
function computeDisplayPath(
  pipeline: import('../../shared/types').Pipeline,
  currentStatus: string,
  transitionEntries: DebugTimelineEntry[],
): { displayPath: string[]; currentIndex: number; skippedStatuses: Set<string> } {
  const sortedTransitions = [...transitionEntries].sort((a, b) => a.timestamp - b.timestamp);
  const visitedStatuses: string[] = [];
  for (const entry of sortedTransitions) {
    const from = entry.data?.fromStatus as string | undefined;
    const to = entry.data?.toStatus as string | undefined;
    if (from && visitedStatuses.length === 0) visitedStatuses.push(from);
    if (from && visitedStatuses[visitedStatuses.length - 1] !== from) visitedStatuses.push(from);
    if (to) visitedStatuses.push(to);
  }

  const happyPath = computeHappyPath(pipeline);
  const happySet = new Set(happyPath);
  const visitedSet = new Set(visitedStatuses);
  const skippedStatuses = new Set<string>();

  if (visitedStatuses.length === 0) {
    let displayPath = happyPath;
    let currentIndex = displayPath.indexOf(currentStatus);
    if (currentIndex === -1) {
      displayPath = [currentStatus, ...happyPath.filter((s) => s !== currentStatus)];
      currentIndex = 0;
    }
    return { displayPath, currentIndex, skippedStatuses };
  }

  // Collapse consecutive duplicates (from self-transitions like retries)
  const collapsed: string[] = [];
  for (const s of visitedStatuses) {
    if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== s) {
      collapsed.push(s);
    }
  }

  // Check for loops: non-consecutive revisits (e.g. pr_review → implementing)
  const seenOnce = new Set<string>();
  let hasLoops = false;
  for (const s of collapsed) {
    if (seenOnce.has(s)) { hasLoops = true; break; }
    seenOnce.add(s);
  }

  if (hasLoops) {
    // Show full history including loops so the revisit is visible
    const historyPath = [...collapsed];
    if (historyPath[historyPath.length - 1] !== currentStatus) {
      historyPath.push(currentStatus);
    }
    const currentIndex = historyPath.length - 1;

    // Project forward using happy path from current status
    const happyIdx = happyPath.indexOf(currentStatus);
    let future: string[];
    if (happyIdx >= 0) {
      future = happyPath.slice(happyIdx + 1);
    } else {
      // Fallback: project forward excluding already-shown statuses
      future = projectForward(currentStatus, pipeline, new Set(historyPath));
    }

    const displayPath = [...historyPath, ...future];
    return { displayPath, currentIndex, skippedStatuses };
  }

  // Dedup visited preserving order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of visitedStatuses) {
    if (!seen.has(s)) { seen.add(s); deduped.push(s); }
  }
  if (!seen.has(currentStatus)) {
    deduped.push(currentStatus);
    seen.add(currentStatus);
  }

  // If current is in the happy path, merge visited with full happy path
  // to show skipped steps in their natural position
  if (happySet.has(currentStatus)) {
    const happyIndex = new Map(happyPath.map((s, i) => [s, i]));
    const currentHappyIdx = happyIndex.get(currentStatus)!;

    // Identify skipped: in happy path, before current, not visited
    for (let i = 0; i < currentHappyIdx; i++) {
      if (!visitedSet.has(happyPath[i])) {
        skippedStatuses.add(happyPath[i]);
      }
    }

    // Merge: walk happy path up to current, inserting extra visited
    // steps at the position they were first reached
    const merged: string[] = [];
    const mergedSet = new Set<string>();
    let dedupedIdx = 0;

    for (let hi = 0; hi <= currentHappyIdx; hi++) {
      const hStep = happyPath[hi];
      // Insert extra visited steps that came before this happy step
      while (dedupedIdx < deduped.length) {
        const ds = deduped[dedupedIdx];
        if (ds === hStep) break;
        if (happySet.has(ds) && (happyIndex.get(ds)! > hi)) break;
        if (!mergedSet.has(ds)) { merged.push(ds); mergedSet.add(ds); }
        dedupedIdx++;
      }
      if (!mergedSet.has(hStep)) { merged.push(hStep); mergedSet.add(hStep); }
      if (dedupedIdx < deduped.length && deduped[dedupedIdx] === hStep) dedupedIdx++;
    }
    // Append remaining visited steps
    for (; dedupedIdx < deduped.length; dedupedIdx++) {
      if (!mergedSet.has(deduped[dedupedIdx])) {
        merged.push(deduped[dedupedIdx]);
        mergedSet.add(deduped[dedupedIdx]);
      }
    }

    const future = projectForward(currentStatus, pipeline, mergedSet);
    const displayPath = [...merged, ...future];
    const currentIndex = displayPath.indexOf(currentStatus);
    return { displayPath, currentIndex, skippedStatuses };
  }

  // Fallback: current not in happy path (e.g. needs_info)
  const future = projectForward(currentStatus, pipeline, seen);
  const displayPath = [...deduped, ...future];
  const currentIndex = displayPath.indexOf(currentStatus);
  return { displayPath, currentIndex, skippedStatuses };
}

/** Pipeline progress visualization */
function PipelineProgress({
  pipeline,
  currentStatus,
  transitionEntries,
  agentState = 'idle',
}: {
  pipeline: import('../../shared/types').Pipeline;
  currentStatus: string;
  transitionEntries: DebugTimelineEntry[];
  agentState?: 'idle' | 'running' | 'failed';
}) {
  const statusLabelMap = new Map(pipeline.statuses.map((s) => [s.name, s.label]));
  const agenticStatuses = computeAgenticStatuses(pipeline);
  const { displayPath, currentIndex, skippedStatuses } = computeDisplayPath(pipeline, currentStatus, transitionEntries);

  return (
    <Card className="mt-4">
      <CardContent className="py-6">
        <div className="flex flex-wrap items-center gap-y-4">
          {displayPath.map((statusName, i) => {
            const isSkipped = skippedStatuses.has(statusName);
            const isCompleted = !isSkipped && i < currentIndex;
            const isCurrent = i === currentIndex;
            const isFuture = !isSkipped && i > currentIndex;
            const label = statusLabelMap.get(statusName) ?? statusName;
            const isAgentic = agenticStatuses.has(statusName);
            const statusDef = pipeline.statuses.find((s) => s.name === statusName);
            const isFinalCurrent = isCurrent && statusDef?.isFinal;

            // Node color
            const nodeColor = isSkipped ? '#d1d5db'
              : isCompleted || isFinalCurrent ? '#22c55e'
              : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#3b82f6')
              : '#d1d5db';

            // Connector: gray dashed if adjacent to skipped step
            const prevSkipped = i > 0 && skippedStatuses.has(displayPath[i - 1]);
            const connectorSkipped = isSkipped || prevSkipped;

            return (
              <React.Fragment key={`${statusName}-${i}`}>
                {/* Connector line */}
                {i > 0 && (
                  <div
                    className="flex-shrink-0"
                    style={{
                      width: 32,
                      height: 2,
                      backgroundColor: connectorSkipped ? 'transparent' : (i <= currentIndex ? '#22c55e' : '#d1d5db'),
                      borderBottom: connectorSkipped ? '2px dashed #d1d5db' : undefined,
                    }}
                  />
                )}
                {/* Node */}
                <div className="flex flex-col items-center gap-1.5" style={{ minWidth: 64, opacity: isSkipped ? 0.5 : 1 }}>
                  <div
                    className="relative flex items-center justify-center rounded-full"
                    style={{
                      width: isSkipped ? 22 : 28,
                      height: isSkipped ? 22 : 28,
                      backgroundColor: nodeColor,
                      boxShadow: isAgentic && !isSkipped ? agenticRing(nodeColor) : undefined,
                    }}
                  >
                    {(isCompleted || isFinalCurrent) && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {isSkipped && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M3 6h6" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                    {isCurrent && !isFinalCurrent && agentState === 'running' && (
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
                    {isCurrent && !isFinalCurrent && agentState === 'idle' && (
                      <span
                        className="relative inline-flex rounded-full"
                        style={{ width: 10, height: 10, backgroundColor: '#fff' }}
                      />
                    )}
                    {isCurrent && !isFinalCurrent && agentState === 'failed' && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M4 4l6 6M10 4l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                      </svg>
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
                      color: isSkipped ? '#9ca3af'
                        : isCompleted || isFinalCurrent ? '#16a34a'
                        : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#2563eb')
                        : '#9ca3af',
                      textDecoration: isSkipped ? 'line-through' : undefined,
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

/** Build a map of status details indexed by position in the display path */
function buildPositionDetailsMap(
  displayPath: string[],
  transitionEntries: DebugTimelineEntry[],
): Map<number, { timestamp: number; trigger?: string; guardResults?: unknown; duration?: number }> {
  const sorted = [...transitionEntries].sort((a, b) => a.timestamp - b.timestamp);
  const result = new Map<number, { timestamp: number; trigger?: string; guardResults?: unknown; duration?: number }>();

  let pathPos = 0;
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const toStatus = entry.data?.toStatus as string | undefined;
    if (!toStatus) continue;

    // Find next matching position in display path
    let matchPos = pathPos + 1;
    while (matchPos < displayPath.length && displayPath[matchPos] !== toStatus) {
      matchPos++;
    }
    if (matchPos >= displayPath.length) continue;

    const nextTimestamp = i + 1 < sorted.length ? sorted[i + 1].timestamp : undefined;
    const duration = nextTimestamp != null ? nextTimestamp - entry.timestamp : undefined;

    result.set(matchPos, {
      timestamp: entry.timestamp,
      trigger: entry.data?.trigger as string | undefined,
      guardResults: entry.data?.guardResults,
      duration,
    });

    pathPos = matchPos;
  }

  return result;
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
  agentState = 'idle',
}: {
  pipeline: import('../../shared/types').Pipeline;
  currentStatus: string;
  transitionEntries: DebugTimelineEntry[];
  agentState?: 'idle' | 'running' | 'failed';
}) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const statusLabelMap = new Map(pipeline.statuses.map((s) => [s.name, s.label]));
  const agenticStatuses = computeAgenticStatuses(pipeline);
  const { displayPath, currentIndex, skippedStatuses } = computeDisplayPath(pipeline, currentStatus, transitionEntries);
  const positionDetailsMap = buildPositionDetailsMap(displayPath, transitionEntries);

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
            const isSkipped = skippedStatuses.has(statusName);
            const isCompleted = !isSkipped && i < currentIndex;
            const isCurrent = i === currentIndex;
            const isFuture = !isSkipped && i > currentIndex;
            const label = statusLabelMap.get(statusName) ?? statusName;
            const isAgentic = agenticStatuses.has(statusName);
            const statusDef = pipeline.statuses.find((s) => s.name === statusName);
            const isFinalCurrent = isCurrent && statusDef?.isFinal;
            const details = positionDetailsMap.get(i);
            const hasDetails = !isSkipped && (isCompleted || isFinalCurrent || (isCurrent && details));
            const expanded = expandedSteps.has(i);

            // Node color
            const nodeColor = isSkipped ? '#d1d5db'
              : isCompleted || isFinalCurrent ? '#22c55e'
              : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#3b82f6')
              : '#d1d5db';

            // Connector: dashed if adjacent to skipped step
            const nextSkipped = i + 1 < displayPath.length && skippedStatuses.has(displayPath[i + 1]);
            const connectorDashed = isSkipped || nextSkipped;

            // For current step, compute live duration
            const currentDuration = isCurrent && !isFinalCurrent && details
              ? Date.now() - details.timestamp
              : undefined;

            return (
              <div key={`${statusName}-${i}`} className="flex" style={{ opacity: isSkipped ? 0.5 : 1 }}>
                {/* Left column: node + connector */}
                <div className="flex flex-col items-center mr-4" style={{ width: 28 }}>
                  {/* Node */}
                  <div
                    className="relative flex items-center justify-center rounded-full flex-shrink-0"
                    style={{
                      width: isSkipped ? 22 : 28,
                      height: isSkipped ? 22 : 28,
                      backgroundColor: nodeColor,
                      boxShadow: isAgentic && !isSkipped ? agenticRing(nodeColor) : undefined,
                    }}
                  >
                    {(isCompleted || isFinalCurrent) && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {isSkipped && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M3 6h6" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                    {isCurrent && !isFinalCurrent && agentState === 'running' && (
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
                    {isCurrent && !isFinalCurrent && agentState === 'idle' && (
                      <span
                        className="relative inline-flex rounded-full"
                        style={{ width: 10, height: 10, backgroundColor: '#fff' }}
                      />
                    )}
                    {isCurrent && !isFinalCurrent && agentState === 'failed' && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M4 4l6 6M10 4l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                      </svg>
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
                        width: 0,
                        minHeight: expanded ? 8 : 24,
                        borderLeft: connectorDashed
                          ? '2px dashed #d1d5db'
                          : `2px solid ${i < currentIndex ? '#22c55e' : '#d1d5db'}`,
                      }}
                    />
                  )}
                </div>

                {/* Right column: label + details */}
                <div className={`flex-1 ${i < displayPath.length - 1 ? 'pb-2' : ''}`}>
                  <div
                    className={`flex items-center gap-2 py-1 rounded -mt-0.5 ${hasDetails ? 'cursor-pointer hover:bg-accent/50' : ''}`}
                    style={{ minHeight: isSkipped ? 22 : 28 }}
                    onClick={() => hasDetails && toggleStep(i)}
                  >
                    <span
                      className="text-sm font-medium"
                      style={{
                        color: isSkipped ? '#9ca3af'
                          : isCompleted || isFinalCurrent ? '#16a34a'
                          : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#2563eb')
                          : '#9ca3af',
                        textDecoration: isSkipped ? 'line-through' : undefined,
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
                    <div className="ml-1 mt-1 mb-2 pl-3 border-l-2 text-xs space-y-1.5" style={{ borderColor: isCompleted || isFinalCurrent ? '#22c55e' : '#3b82f6' }}>
                      {(isCompleted || isFinalCurrent) && details && (
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
                      {isCurrent && !isFinalCurrent && details && (
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
