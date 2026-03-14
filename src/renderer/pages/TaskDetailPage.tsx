import React, { useState, useEffect, useCallback, useRef } from 'react';
import itermIcon from '../assets/iterm-icon.png';
import vscodeIcon from '../assets/vscode-icon.png';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { InlineError } from '../components/InlineError';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../components/ui/select';
import { useTask } from '../hooks/useTasks';
import { usePipeline, usePipelines } from '../hooks/usePipelines';
import { useFeatures } from '../hooks/useFeatures';
import { usePipelineDiagnostics } from '../hooks/usePipelineDiagnostics';
import { useHookRetry } from '../hooks/useHookRetry';
import { PipelineBadge } from '../components/pipeline/PipelineBadge';
import { PipelineControlPanel } from '../components/pipeline/PipelineControlPanel';
import { HookFailureBanner } from '../components/pipeline/HookFailureBanner';
import { PipelineProgress } from '../components/pipeline/PipelineProgress';
import { WorkflowReviewTab } from '../components/tasks/WorkflowReviewTab';
import { ImplementationTab } from '../components/tasks/ImplementationTab';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { PlanReviewCard } from '../components/plan/PlanReviewCard';
import type {
  Transition, TaskArtifact, AgentRun, TaskUpdateInput, PendingPrompt,
  DebugTimelineEntry, Worktree, TaskContextEntry, HookFailure,
} from '../../shared/types';
import { usePipelineStatusMeta } from '../hooks/usePipelineStatusMeta';
import { ChatPanel } from '../components/chat/ChatPanel';

import { TaskDetailDashboard } from '../components/task-detail/TaskDetailDashboard';
import { PlanMarkdown } from '../components/task-detail/PlanMarkdown';
import type { QuestionResponse } from '../components/prompts/QuestionForm';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useTaskPolling } from '../hooks/useTaskPolling';
import { BugReportDialog } from '../components/bugs/BugReportDialog';
import type { BugReportInitialValues } from '../components/bugs/BugReportDialog';
import type { HookFailureRecord } from '../../shared/types';

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { task, loading, error, refetch } = useTask(id!);
  const { pipeline } = usePipeline(task?.pipelineId);
  const statusMeta = usePipelineStatusMeta(task, pipeline);
  const { features } = useFeatures(task ? { projectId: task.projectId } : undefined);
  const { pipelines } = usePipelines();

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
  const lastRun = agentRuns?.[0] ?? null;
  const isAgentPhase = statusMeta.isAgentRunning;
  const isFinalizing = isAgentPhase && !hasRunningAgent && agentRuns !== null
    && lastRun?.status === 'completed' && lastRun.completedAt != null
    && (Date.now() - lastRun.completedAt) < 30000;
  const isStuck = isAgentPhase && !hasRunningAgent && agentRuns !== null && !isFinalizing;

  // Poll while agent is running, needs_info, finalizing, stuck, or waiting for PR
  const awaitingPr = statusMeta.isHumanReview && !task?.prLink;
  const shouldPoll = hasRunningAgent || statusMeta.isWaitingForInput || isFinalizing || isStuck || awaitingPr;

  useTaskPolling(id, shouldPoll, hasRunningAgent, {
    refetch, refetchTransitions, refetchAgentRuns, refetchPrompts, refetchDebug, refetchContext,
  });

  // Navigate away if the current task is deleted from another session
  useEffect(() => {
    const unsubscribe = window.api.on.taskDeleted((taskId) => {
      if (taskId === id) {
        navigate('/tasks');
      }
    });
    return unsubscribe;
  }, [id, navigate]);

  const initialTab = task?.status === 'plan_review' ? 'plan'
    : task?.status === 'design_review' ? 'design'
    : (task?.status === 'pr_review' || task?.status === 'ready_to_merge') ? 'implementation'
    : 'details';
  const [tab, setTab] = useLocalStorage(`taskDetail.tab.${id}`, initialTab);

  // Auto-navigate to review sub-page when the status *transitions* into a review state
  // while the user is already viewing the task. We skip the initial load (prev === undefined)
  // to avoid redirecting when the user intentionally opens a task that's already in review.
  const prevStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = task?.status;

    // Skip initial load and no-change cases
    if (!prev || prev === task?.status) return;

    if (task?.status === 'plan_review') {
      navigate(`/tasks/${id}/plan`);
    } else if (task?.status === 'design_review') {
      navigate(`/tasks/${id}/design`);
    } else if (task?.status === 'pr_review' || task?.status === 'ready_to_merge') {
      setTab('implementation');
    }
  }, [task?.status, id, navigate, setTab]);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<TaskUpdateInput>({});
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetPipelineId, setResetPipelineId] = useState<string | undefined>(undefined);
  const [duplicating, setDuplicating] = useState(false);
  // Prompt response state
  const [responding, setResponding] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  // Hook failure alerts from transitions
  const [hookFailureAlerts, setHookFailureAlerts] = useState<HookFailure[]>([]);

  // Bug report dialog state
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [bugReportInitialValues, setBugReportInitialValues] = useState<BugReportInitialValues | undefined>(undefined);

  // Diagnostics hooks lifted from PipelineControlPanel
  const { diagnostics, refetch: refetchDiagnostics, error: diagnosticsError } = usePipelineDiagnostics(id!, task?.status ?? '');
  const { retry, retrying } = useHookRetry();

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
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : 'Failed to save task. Please try again.');
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
      const result = await window.api.tasks.transition(id, toStatus, 'admin');
      if (result.success) {
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

  const handleFeedbackAction = async (toStatus: string, comment: string, entryType: string) => {
    try {
      if (comment.trim()) {
        await window.api.tasks.addFeedback(id!, { entryType, content: comment.trim() });
        await refetchContext();
      }
      await handleTransition(toStatus);
    } catch (err) {
      console.error(`Feedback action failed (${entryType}):`, err);
      setTransitionError(err instanceof Error ? err.message : 'Failed to submit feedback');
    }
  };

  const handleStructuredPromptRespond = async (promptId: string, responses: QuestionResponse[]) => {
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
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : 'Failed to delete task. Please try again.');
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleReset = async () => {
    if (!id) return;
    setResetting(true);
    try {
      const newPipelineId = resetPipelineId !== task?.pipelineId ? resetPipelineId : undefined;
      await window.api.tasks.reset(id, newPipelineId);
      setResetOpen(false);
      setResetPipelineId(undefined);
      await refetch();
      await refetchTransitions();
      await refetchAgentRuns();
      await refetchPrompts();
      await refetchDebug();
      await refetchContext();
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : 'Failed to reset task. Please try again.');
      setResetOpen(false);
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
        debugInfo: task.debugInfo ?? undefined,
        priority: task.priority,
        assignee: task.assignee ?? undefined,
        tags: task.tags,
      });
      navigate(`/tasks/${newTask.id}`);
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : 'Failed to duplicate task. Please try again.');
    } finally {
      setDuplicating(false);
    }
  };

  const handleRetryHook = useCallback(async (hookName: string, from: string, to: string) => {
    try {
      const result = await retry(id!, hookName, from, to);
      if (result.success) {
        refetchDiagnostics();
      } else {
        setTransitionError(`Hook retry failed for "${hookName}": ${result.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : `Hook retry failed for "${hookName}"`);
    }
  }, [id, retry, refetchDiagnostics]);

  const handleDismissFailure = useCallback(async (failureIds: string[]) => {
    await Promise.all(failureIds.map((eventId) => window.api.tasks.dismissEvent(id!, eventId)));
    refetchDiagnostics();
  }, [id, refetchDiagnostics]);

  const handleReportBugFromFailure = useCallback((failure: HookFailureRecord) => {
    try {
      const timestamp = isFinite(failure.timestamp)
        ? new Date(failure.timestamp).toISOString()
        : String(failure.timestamp);
      const lines = [
        `- **Hook:** \`${failure.hookName}\``,
        `- **Error:** ${failure.error}`,
        `- **Policy:** ${failure.policy}`,
        `- **Transition:** ${failure.transitionFrom} → ${failure.transitionTo}`,
        `- **Timestamp:** ${timestamp}`,
      ];
      if (task) {
        lines.push(`- **Task:** ${task.title}`);
        lines.push(`- **Status:** ${task.status}`);
        if (task.branchName) lines.push(`- **Branch:** \`${task.branchName}\``);
        if (task.prLink) lines.push(`- **PR:** ${task.prLink}`);
      }
      setBugReportInitialValues({
        title: `Hook failed: ${failure.hookName} - ${failure.error}`,
        description: lines.join('\n'),
        autoLoadDebugLogs: true,
      });
    } catch (err) {
      console.error('[TaskDetailPage] Failed to build bug report from failure:', err);
      setBugReportInitialValues({
        title: 'Hook failure (details could not be loaded)',
        description: `Raw error: ${String(failure?.error ?? 'unknown')}`,
        autoLoadDebugLogs: true,
      });
    }
    setBugReportOpen(true);
  }, [task]);

  const handleReportBugFromHookAlert = useCallback((failure: HookFailure) => {
    try {
      const lines = [
        `- **Hook:** \`${failure.hook}\``,
        `- **Error:** ${failure.error}`,
        `- **Policy:** ${failure.policy}`,
      ];
      if (task) {
        lines.push(`- **Task:** ${task.title}`);
        lines.push(`- **Status:** ${task.status}`);
        if (task.branchName) lines.push(`- **Branch:** \`${task.branchName}\``);
        if (task.prLink) lines.push(`- **PR:** ${task.prLink}`);
      }
      setBugReportInitialValues({
        title: `Hook failed: ${failure.hook} - ${failure.error}`,
        description: lines.join('\n'),
        autoLoadDebugLogs: true,
      });
    } catch (err) {
      console.error('[TaskDetailPage] Failed to build bug report from hook alert:', err);
      setBugReportInitialValues({
        title: 'Hook failure (details could not be loaded)',
        description: `Raw error: ${String(failure?.error ?? 'unknown')}`,
        autoLoadDebugLogs: true,
      });
    }
    setBugReportOpen(true);
  }, [task]);

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
        <InlineError message={error || 'Task not found'} context="Task detail" />
      </div>
    );
  }

  // Determine primary vs secondary transitions
  const hasCategories = statusMeta.category !== undefined;
  const allTransitions = transitions ?? [];
  let primaryTransitions: Transition[];
  let secondaryTransitions: Transition[];
  if (!hasCategories) {
    primaryTransitions = allTransitions;
    secondaryTransitions = [];
  } else if (statusMeta.isReady || statusMeta.isHumanReview) {
    primaryTransitions = allTransitions;
    secondaryTransitions = [];
  } else if (statusMeta.isAgentRunning) {
    primaryTransitions = isStuck ? allTransitions : [];
    secondaryTransitions = isStuck ? [] : allTransitions;
  } else {
    primaryTransitions = [];
    secondaryTransitions = allTransitions;
  }

  const visibleDiagnosticFailures = diagnostics?.recentHookFailures ?? [];
  const hasVisibleBanners = transitionError !== null || diagnosticsError !== null || hookFailureAlerts.length > 0 || visibleDiagnosticFailures.length > 0;

  // Tab content indicators
  const hasPlan = !!task.plan;
  const hasDesign = !!task.technicalDesign;
  const hasImplementation = !!task.prLink || (artifacts?.some((a) => a.type === 'diff') ?? false);
  const hasReview = contextEntries?.some(e => e.entryType === 'workflow_review') ?? false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* UNIFIED HEADER */}
      <div style={{ flexShrink: 0, background: 'var(--card)' }}>

        {/* Breadcrumb + actions */}
        <div style={{
          display: 'flex', alignItems: 'center', height: 40, minHeight: 40,
          padding: '0 24px', gap: 8,
        }}>
          <button
            onClick={() => (navigate as (delta: number) => void)(-1)}
            style={{ fontSize: 13, color: 'var(--muted-foreground)', cursor: 'pointer', background: 'none', border: 'none', padding: '2px 4px' }}
          >
            ← Back
          </button>
          <span style={{ color: 'var(--border)', fontSize: 13 }}>/</span>
          <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Tasks</span>
          <span style={{ color: 'var(--border)', fontSize: 13 }}>/</span>
          <span style={{ fontSize: 13, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
            {task.title}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {worktree?.path && (
              <>
                <Button variant="outline" size="sm" title="Open in iTerm" onClick={() => window.api.shell.openInIterm(worktree.path)}>
                  <img src={itermIcon} alt="iTerm" width={16} height={16} />
                </Button>
                <Button variant="outline" size="sm" title="Open in VS Code" onClick={() => window.api.shell.openInVscode(worktree.path)}>
                  <img src={vscodeIcon} alt="VS Code" width={16} height={16} />
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={handleDuplicate} disabled={duplicating}>
              {duplicating ? 'Duplicating...' : 'Duplicate'}
            </Button>
            <Button variant="outline" size="sm" onClick={openEdit}>Edit</Button>
            <Button variant="outline" size="sm" onClick={() => { setResetPipelineId(task.pipelineId); setResetOpen(true); }} disabled={hasRunningAgent}>Reset</Button>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>Delete</Button>
          </div>
        </div>

        {/* Title + meta + controls */}
        <div style={{ padding: '6px 24px 0' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{task.title}</h1>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4, fontSize: 12, color: 'var(--muted-foreground)' }}>
            <PipelineBadge status={task.status} pipeline={pipeline} />
            {pipeline && <><span>·</span><span>{pipeline.name}</span></>}
            {task.featureId && <><span>·</span><span>{task.featureId}</span></>}
            {task.priority !== undefined && <><span>·</span><span>P{task.priority}</span></>}
            <span>·</span>
            <span>{new Date(task.createdAt).toLocaleDateString()}</span>
            {worktree && (
              <>
                <span>·</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--primary)', backgroundColor: 'rgba(59,130,246,0.1)', padding: '1px 6px', borderRadius: 4 }}>
                  {worktree.path ?? worktree.branch}
                </span>
              </>
            )}
            {(!isAgentPipeline || agentRuns !== null) && (
              <div style={{ marginLeft: 4 }}>
                <PipelineControlPanel
                  taskId={id!}
                  task={task}
                  isAgentPipeline={isAgentPipeline}
                  hasRunningAgent={hasRunningAgent}
                  lastRun={lastRun}
                  isStuck={isStuck}
                  isFinalizing={isFinalizing}
                  primaryTransitions={primaryTransitions}
                  transitioning={transitioning}
                  statusMeta={statusMeta}
                  pipelineStatuses={pipeline?.statuses ?? []}
                  onTransition={handleTransition}
                  onNavigateToRun={(runId) => navigate(`/agents/${runId}`)}
                  onHookFailures={(failures) => setHookFailureAlerts((prev) => [...prev, ...failures])}
                  diagnostics={diagnostics}
                  refetchDiagnostics={refetchDiagnostics}
                />
              </div>
            )}
          </div>
        </div>

        {/* Pipeline progress */}
        {pipeline && (
          <PipelineProgress
            pipeline={pipeline}
            currentStatus={task.status}
            transitionEntries={(debugTimeline ?? []).filter((e) => e.source === 'transition')}
            agentState={hasRunningAgent ? 'running' : isStuck ? 'failed' : 'idle'}
            agentRuns={agentRuns}
            onNavigateToRun={(runId) => navigate(`/agents/${runId}`)}
            implPhases={task.phases}
          />
        )}

      </div>

      {/* 4. HOOK FAILURE BANNERS */}
      {hasVisibleBanners && (
        <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
          {transitionError && (
            <div style={{
              padding: '8px 24px', background: '#1c0a0a',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13,
            }}>
              <span style={{ color: '#f87171' }}>{transitionError}</span>
              <button onClick={() => setTransitionError(null)} style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>&times;</button>
            </div>
          )}
          {diagnosticsError && (
            <div style={{
              padding: '8px 24px', background: '#1c0a0a',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13,
            }}>
              <span style={{ color: '#f87171' }}>Could not load pipeline diagnostics: {diagnosticsError}</span>
            </div>
          )}
          {hookFailureAlerts.length > 0 && (
            <div style={{ padding: '4px 24px' }}>
              {hookFailureAlerts.map((f, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', alignItems: 'start', gap: 12, padding: '8px 0', fontSize: 13 }}
                >
                  <span style={{ color: '#d97706', marginTop: 2 }}>&#x26A0;</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, color: '#d97706' }}>Hook &quot;{f.hook}&quot; failed ({f.policy})</span>
                    <p style={{ fontSize: 12, marginTop: 2, color: '#d97706' }}>{f.error}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReportBugFromHookAlert(f)}
                      style={{ borderColor: '#78350f', color: '#d97706' }}
                    >
                      Report Bug
                    </Button>
                    <button
                      style={{ color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                      onClick={() => setHookFailureAlerts((prev) => prev.filter((_, idx) => idx !== i))}
                    >&times;</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {visibleDiagnosticFailures.length > 0 && (
            <div style={{ padding: '0 24px' }}>
              <HookFailureBanner
                failures={visibleDiagnosticFailures}
                retrying={retrying}
                onRetry={handleRetryHook}
                onDismiss={handleDismissFailure}
                onReportBug={handleReportBugFromFailure}
              />
            </div>
          )}
        </div>
      )}

      {/* 5. TAB BAR + SCROLLABLE CONTENT */}
      <Tabs value={tab} onValueChange={setTab} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <TabsList style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          borderRadius: 0,
          padding: '0 24px',
          justifyContent: 'flex-start',
          height: 36,
          background: 'var(--card)',
        }}>
          <TabsTrigger value="details">Task Details</TabsTrigger>
          <TabsTrigger value="plan" className={hasPlan ? '' : 'opacity-40'}>
            <span className="flex items-center gap-1.5">
              Plan
              {hasPlan && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#3fb950', display: 'inline-block' }} />}
            </span>
          </TabsTrigger>
          <TabsTrigger value="design" className={hasDesign ? '' : 'opacity-40'}>
            <span className="flex items-center gap-1.5">
              Technical Design
              {hasDesign && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#3fb950', display: 'inline-block' }} />}
            </span>
          </TabsTrigger>
          <TabsTrigger value="implementation" className={hasImplementation ? '' : 'opacity-40'}>
            <span className="flex items-center gap-1.5">
              Implementation
              {hasImplementation && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#3fb950', display: 'inline-block' }} />}
            </span>
          </TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="review" className={hasReview ? '' : 'opacity-40'}>Review</TabsTrigger>
        </TabsList>
        <div style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>

        <TabsContent value="details" style={{ padding: '12px 24px', overflowY: 'auto' }}>
          <TaskDetailDashboard
            task={task}
            taskId={id!}
            agentRuns={agentRuns}
            artifacts={artifacts}
            pendingPrompts={pendingPrompts}
            debugTimeline={debugTimeline}
            contextEntries={contextEntries}
            secondaryTransitions={secondaryTransitions}
            transitioning={transitioning}
            responding={responding}
            promptError={promptError}
            onTransition={handleTransition}
            onPromptRespond={handleStructuredPromptRespond}
            onRefetch={refetch}
            onContextRefetch={refetchContext}
          />
        </TabsContent>

        <TabsContent value="plan" style={{ padding: '12px 24px', overflowY: 'auto' }}>
          <PlanReviewCard
            title="Plan"
            content={task.plan}
            emptyContentMessage="No plan yet. A plan will appear here after the planning agent completes."
            entries={(contextEntries ?? []).filter(e => e.entryType === 'plan_feedback')}
            isReviewStatus={task.status === 'plan_review'}
            transitions={transitions ?? []}
            transitioning={transitioning}
            approveToStatus="implementing"
            onAction={(toStatus, comment) => handleFeedbackAction(toStatus, comment, 'plan_feedback')}
            renderContent={(content) => <PlanMarkdown content={content} />}
            reviewPath={`/tasks/${id}/plan`}
          />
        </TabsContent>

        <TabsContent value="design" style={{ padding: '12px 24px', overflowY: 'auto' }}>
          <PlanReviewCard
            title="Technical Design"
            content={task.technicalDesign}
            emptyContentMessage="No technical design yet. A design document will appear here after the design agent completes."
            entries={(contextEntries ?? []).filter(e => e.entryType === 'design_feedback')}
            isReviewStatus={task.status === 'design_review'}
            transitions={transitions ?? []}
            transitioning={transitioning}
            approveToStatus="implementing"
            onAction={(toStatus, comment) => handleFeedbackAction(toStatus, comment, 'design_feedback')}
            renderContent={(content) => <PlanMarkdown content={content} />}
            reviewPath={`/tasks/${id}/design`}
          />
        </TabsContent>

        <TabsContent value="implementation" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <ImplementationTab
            taskId={id!}
            task={task}
            artifacts={artifacts ?? null}
            transitions={transitions ?? []}
            transitioning={transitioning}
            contextEntries={contextEntries ?? null}
            onTransition={handleTransition}
            onContextAdded={refetchContext}
            phases={task.phases}
          />
        </TabsContent>

        <TabsContent value="chat" style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <ChatPanel scope={{ type: 'task', id: id! }} />
        </TabsContent>

        <TabsContent value="review" style={{ padding: '12px 24px', overflowY: 'auto' }}>
          <WorkflowReviewTab
            taskId={id!}
            contextEntries={contextEntries ?? null}
            agentRuns={agentRuns ?? null}
            isFinalStatus={statusMeta.isTerminal}
            onReviewTriggered={() => { refetchAgentRuns(); refetchContext(); }}
          />
        </TabsContent>
        </div>
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
      <Dialog open={resetOpen} onOpenChange={(open) => { setResetOpen(open); if (!open) setResetPipelineId(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Task</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              This will clear all agent-generated data for &quot;{task.title}&quot; and reset the status to the pipeline&apos;s initial state.
            </p>
            {pipelines.length > 1 && (
              <div className="space-y-2">
                <Label>Pipeline</Label>
                <Select
                  value={resetPipelineId ?? task.pipelineId}
                  onValueChange={(v) => setResetPipelineId(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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

      {/* Bug Report Dialog */}
      <BugReportDialog
        open={bugReportOpen}
        onOpenChange={setBugReportOpen}
        initialValues={bugReportInitialValues}
      />
    </div>
  );
}
