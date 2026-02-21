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
import { PipelineControlPanel } from '../components/pipeline/PipelineControlPanel';
import { DebuggerPanel } from '../components/pipeline/DebuggerPanel';
import { PipelineProgress } from '../components/pipeline/PipelineProgress';
import { PipelineVertical } from '../components/pipeline/PipelineVertical';
import { GitTab } from '../components/tasks/GitTab';
import { WorkflowReviewTab } from '../components/tasks/WorkflowReviewTab';
import { TaskCostPanel } from '../components/task/TaskCostPanel';
import { useIpc } from '@template/renderer/hooks/useIpc';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Task, Transition, TaskArtifact, AgentRun, TaskUpdateInput, PendingPrompt,
  DebugTimelineEntry, Worktree, TaskContextEntry, Subtask, SubtaskStatus, PlanComment,
  ImplementationPhase, HookFailure,
} from '../../shared/types';
import { usePipelineStatusMeta } from '../hooks/usePipelineStatusMeta';
import { QuestionForm } from '../components/prompts/QuestionForm';

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

  const initialTab = task?.status === 'plan_review' ? 'plan' : task?.status === 'design_review' ? 'design' : 'overview';
  const [tab, setTab] = useState(initialTab);

  // Auto-switch to relevant tab when entering review statuses
  useEffect(() => {
    if (task?.status === 'plan_review') setTab('plan');
    else if (task?.status === 'design_review') setTab('design');
  }, [task?.status]);

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

  // Prompt response state
  const [responding, setResponding] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  // Hook failure alerts from transitions
  const [hookFailureAlerts, setHookFailureAlerts] = useState<HookFailure[]>([]);

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
    // Special signal from PipelineControlPanel after a force transition
    if (toStatus === '__force_refresh__') {
      await refetch();
      await refetchTransitions();
      await refetchAgentRuns();
      await refetchPrompts();
      return;
    }
    setTransitioning(toStatus);
    setTransitionError(null);
    try {
      const result = await window.api.tasks.transition(id, toStatus);
      if (result.success) {
        // Surface hook failures from successful transitions
        if (result.hookFailures && result.hookFailures.length > 0) {
          setHookFailureAlerts((prev) => [...prev, ...result.hookFailures!]);
        }
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

  const handleStructuredPromptRespond = async (promptId: string, responses: import('../components/prompts/QuestionForm').QuestionResponse[]) => {
    setResponding(true);
    setPromptError(null);
    try {
      const result = await window.api.prompts.respond(promptId, { answers: responses });
      if (!result) {
        setPromptError('This prompt has already been answered.');
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
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => (navigate as (delta: number) => void)(-1)}>
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

      {/* Pipeline Control Panel — defer for agent pipelines until agentRuns loads */}
      {(!isAgentPipeline || agentRuns !== null) && (
        <PipelineControlPanel
          taskId={id!}
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
          pipelineStatuses={pipeline?.statuses ?? []}
          onTransition={handleTransition}
          onStopAgent={handleStopAgent}
          onNavigateToRun={(runId) => navigate(`/agents/${runId}`)}
          hookFailureAlerts={hookFailureAlerts}
          onDismissHookAlert={(i) => setHookFailureAlerts((prev) => prev.filter((_, idx) => idx !== i))}
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
          <TabsTrigger value="design">Technical Design</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="agents">Agent Runs</TabsTrigger>
          <TabsTrigger value="context">Context</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
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
                    <button
                      onClick={() => window.api.shell.openInChrome(task.prLink!)}
                      className="text-sm text-blue-500 hover:underline break-all text-left cursor-pointer"
                    >
                      {task.prLink}
                    </button>
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

          {/* Subtasks — phased or flat */}
          {task.phases && task.phases.length > 1 ? (
            <PhasedSubtasksSection taskId={id!} phases={task.phases} onUpdate={refetch} />
          ) : (
            <SubtasksSection taskId={id!} subtasks={task.subtasks} onUpdate={refetch} />
          )}

          {/* Dependencies */}
          <DependenciesSection taskId={id!} projectId={task.projectId} />

          {/* Pending Prompt UI — show whenever there are pending prompts, not just in needs_info */}
          {pendingPrompts && pendingPrompts.some(p => p.status === 'pending') && (
            <Card className="mt-4 border-amber-400">
              <CardHeader className="py-3">
                <CardTitle className="text-base text-amber-600">Agent needs your input</CardTitle>
              </CardHeader>
              <CardContent>
                {pendingPrompts.filter((p) => p.status === 'pending').map((prompt) => (
                  <QuestionForm
                    key={prompt.id}
                    prompt={prompt}
                    onSubmit={(responses) => handleStructuredPromptRespond(prompt.id, responses)}
                    submitting={responding}
                    error={promptError}
                  />
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

        <TabsContent value="design">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Technical Design</CardTitle>
            </CardHeader>
            <CardContent>
              {task.technicalDesign ? (
                <PlanMarkdown content={task.technicalDesign} />
              ) : (
                <p className="text-sm text-muted-foreground">No technical design yet. A design document will appear here after the design agent completes.</p>
              )}
            </CardContent>
          </Card>

          {/* Design Review Actions */}
          {task.status === 'design_review' && (
            <DesignReviewSection
              taskId={id!}
              designComments={task.technicalDesignComments}
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

        <TabsContent value="review">
          <WorkflowReviewTab
            taskId={id!}
            contextEntries={contextEntries ?? null}
            agentRuns={agentRuns ?? null}
            isFinalStatus={statusMeta.isTerminal}
            onReviewTriggered={() => { refetchAgentRuns(); refetchContext(); }}
          />
        </TabsContent>

        <TabsContent value="cost">
          <TaskCostPanel runs={agentRuns ?? []} />
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

/** Design Review Section */
function DesignReviewSection({
  taskId,
  designComments,
  transitions,
  transitioning,
  onTransition,
  onRefetch,
}: {
  taskId: string;
  designComments: PlanComment[];
  transitions: Transition[];
  transitioning: string | null;
  onTransition: (toStatus: string) => Promise<void> | void;
  onRefetch: () => Promise<void> | void;
}) {
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);

  const approveTransition = transitions.find((t) => t.to === 'implementing');
  const reviseTransition = transitions.find((t) => t.to === 'designing');

  const handleAction = async (toStatus: string) => {
    setSaving(true);
    try {
      if (newComment.trim()) {
        const comment: PlanComment = {
          author: 'admin',
          content: newComment.trim(),
          createdAt: Date.now(),
        };
        await window.api.tasks.update(taskId, {
          technicalDesignComments: [...(designComments ?? []), comment],
        });
        setNewComment('');
        await onRefetch();
      }
      await onTransition(toStatus);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-4 border-blue-400">
      <CardHeader className="py-3">
        <CardTitle className="text-base">Design Review</CardTitle>
      </CardHeader>
      <CardContent>
        {designComments && designComments.length > 0 && (
          <div className="space-y-2 mb-4">
            {designComments.map((comment, i) => (
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

        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add feedback for the design agent..."
          rows={3}
          className="mb-3"
        />

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
              {transitioning === reviseTransition.to ? 'Requesting...' : 'Request Design Changes'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Subtasks Section */
function PhasedSubtasksSection({
  taskId,
  phases,
  onUpdate,
}: {
  taskId: string;
  phases: ImplementationPhase[];
  onUpdate: () => void;
}) {
  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>(() => {
    // Auto-expand the active phase
    const initial: Record<string, boolean> = {};
    for (const p of phases) {
      initial[p.id] = p.status === 'in_progress';
    }
    return initial;
  });

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => ({ ...prev, [phaseId]: !prev[phaseId] }));
  };

  const cycleSubtaskStatus = async (phaseIdx: number, subtaskIdx: number) => {
    const order: SubtaskStatus[] = ['open', 'in_progress', 'done'];
    const phase = phases[phaseIdx];
    const current = phase.subtasks[subtaskIdx].status;
    const next = order[(order.indexOf(current) + 1) % order.length];
    const updatedPhases = phases.map((p, pi) =>
      pi === phaseIdx
        ? { ...p, subtasks: p.subtasks.map((s, si) => si === subtaskIdx ? { ...s, status: next } : s) }
        : p
    );
    await window.api.tasks.update(taskId, { phases: updatedPhases });
    onUpdate();
  };

  const totalSubtasks = phases.reduce((sum, p) => sum + p.subtasks.length, 0);
  const totalDone = phases.reduce((sum, p) => sum + p.subtasks.filter(s => s.status === 'done').length, 0);
  const completedPhases = phases.filter(p => p.status === 'completed').length;

  const phaseStatusColor = (status: string) => {
    if (status === 'completed') return '#22c55e';
    if (status === 'in_progress') return '#3b82f6';
    return '#9ca3af';
  };

  return (
    <Card className="mt-4">
      <CardHeader className="py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Implementation Phases
          <span className="text-sm font-normal text-muted-foreground ml-2">
            {completedPhases}/{phases.length} phases &middot; {totalDone}/{totalSubtasks} subtasks done
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Overall progress bar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: totalSubtasks > 0 ? `${(totalDone / totalSubtasks) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {totalSubtasks > 0 ? Math.round((totalDone / totalSubtasks) * 100) : 0}%
          </span>
        </div>

        <div className="space-y-2">
          {phases.map((phase, phaseIdx) => {
            const phaseDone = phase.subtasks.filter(s => s.status === 'done').length;
            const isExpanded = expandedPhases[phase.id] ?? false;

            return (
              <div key={phase.id} className="border rounded-md overflow-hidden">
                {/* Phase header */}
                <button
                  onClick={() => togglePhase(phase.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                >
                  <span className="text-xs" style={{ color: phaseStatusColor(phase.status) }}>
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: phaseStatusColor(phase.status) }}
                  />
                  <span className="text-sm font-medium flex-1 truncate">{phase.name}</span>
                  <Badge
                    variant={phase.status === 'completed' ? 'success' : phase.status === 'in_progress' ? 'default' : 'outline'}
                    className="text-xs"
                  >
                    {phase.status.replace('_', ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {phaseDone}/{phase.subtasks.length}
                  </span>
                  {phase.prLink && (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.api.shell.openInChrome(phase.prLink!); }}
                      className="text-xs text-blue-500 hover:underline ml-1"
                    >
                      PR
                    </button>
                  )}
                </button>

                {/* Phase subtasks */}
                {isExpanded && phase.subtasks.length > 0 && (
                  <div className="px-3 pb-2 space-y-1">
                    {phase.subtasks.map((st, stIdx) => (
                      <div key={stIdx} className="flex items-center gap-2 group py-1 pl-4">
                        <button
                          onClick={() => cycleSubtaskStatus(phaseIdx, stIdx)}
                          className="flex items-center justify-center w-4 h-4 rounded-full border-2 shrink-0 transition-colors"
                          style={{
                            borderColor: st.status === 'done' ? '#22c55e' : st.status === 'in_progress' ? '#3b82f6' : '#d1d5db',
                            backgroundColor: st.status === 'done' ? '#22c55e' : 'transparent',
                          }}
                          title={`Status: ${st.status} (click to cycle)`}
                        >
                          {st.status === 'done' && (
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6l2.5 2.5 4.5-4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {st.status === 'in_progress' && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#3b82f6' }} />
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
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

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
  'workflow-reviewer': '#e879f9',
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
