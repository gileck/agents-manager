import React, { useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { TaskSubPageLayout } from '../components/task-detail/TaskSubPageLayout';
import { TaskDetailDashboard } from '../components/task-detail/TaskDetailDashboard';
import { ImplementationTab } from '../components/tasks/ImplementationTab';
import { WorkflowReviewTab } from '../components/tasks/WorkflowReviewTab';
import { ChatPanel } from '../components/chat/ChatPanel';
import { InlineError } from '../components/InlineError';
import { useTask } from '../hooks/useTasks';
import { usePipeline } from '../hooks/usePipelines';
import { usePipelineStatusMeta } from '../hooks/usePipelineStatusMeta';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { reportError } from '../lib/error-handler';
import type {
  Transition, TaskArtifact, AgentRun, PendingPrompt,
  DebugTimelineEntry, TaskContextEntry,
} from '../../shared/types';
import type { QuestionResponse } from '../components/prompts/QuestionForm';

const TAB_CONFIG: Record<string, { label: string }> = {
  details: { label: 'Task Details' },
  impl: { label: 'Implementation' },
  chat: { label: 'Chat' },
  review: { label: 'Workflow Review' },
};

export function TaskTabPage() {
  const { id, tab } = useParams<{ id: string; tab: string }>();
  const cfg = TAB_CONFIG[tab ?? ''];

  if (!id || !cfg) {
    return <div className="p-8 text-muted-foreground">Unknown tab: {tab}</div>;
  }

  return (
    <TaskSubPageLayout taskId={id} tabLabel={cfg.label} tabKey={tab === 'impl' ? 'implementation' : tab!}>
      <TabContent id={id} tab={tab!} />
    </TaskSubPageLayout>
  );
}

function TabContent({ id, tab }: { id: string; tab: string }) {
  switch (tab) {
    case 'details': return <DetailsContent id={id} />;
    case 'impl': return <ImplementationContent id={id} />;
    case 'chat': return <ChatContent id={id} />;
    case 'review': return <ReviewContent id={id} />;
    default: return null;
  }
}

// --- Details tab ---
function DetailsContent({ id }: { id: string }) {
  const { task, refetch } = useTask(id);
  const { pipeline } = usePipeline(task?.pipelineId);
  const statusMeta = usePipelineStatusMeta(task, pipeline);

  const { data: agentRuns } = useIpc<AgentRun[]>(
    () => window.api.agents.runs(id), [id],
  );
  const { data: artifacts } = useIpc<TaskArtifact[]>(
    () => window.api.artifacts.list(id), [id],
  );
  const { data: pendingPrompts, refetch: refetchPrompts } = useIpc<PendingPrompt[]>(
    () => window.api.prompts.list(id), [id, task?.status],
  );
  const { data: debugTimeline } = useIpc<DebugTimelineEntry[]>(
    () => window.api.tasks.debugTimeline(id), [id],
  );
  const { data: contextEntries, refetch: refetchContext } = useIpc<TaskContextEntry[]>(
    () => window.api.tasks.contextEntries(id), [id],
  );
  const { data: transitions, error: transitionsError } = useIpc<Transition[]>(
    () => window.api.tasks.transitions(id), [id, task?.status],
  );

  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const hasCategories = statusMeta.category !== undefined;
  const isAgentPhase = statusMeta.isAgentRunning;
  const hasRunningAgent = agentRuns?.some(r => r.status === 'running') ?? false;
  const lastRun = agentRuns?.[0] ?? null;
  const isFinalizing = isAgentPhase && !hasRunningAgent && agentRuns !== null
    && lastRun?.status === 'completed' && lastRun.completedAt != null
    && (Date.now() - lastRun.completedAt) < 30000;
  const isStuck = isAgentPhase && !hasRunningAgent && agentRuns !== null && !isFinalizing;

  const allTransitions = transitions ?? [];
  let secondaryTransitions: Transition[];
  if (!hasCategories) {
    secondaryTransitions = [];
  } else if (statusMeta.isReady || statusMeta.isHumanReview) {
    secondaryTransitions = [];
  } else if (statusMeta.isAgentRunning) {
    secondaryTransitions = isStuck ? [] : allTransitions;
  } else {
    secondaryTransitions = allTransitions;
  }

  const handleTransition = useCallback(async (toStatus: string) => {
    setTransitioning(toStatus);
    try {
      const result = await window.api.tasks.transition(id, toStatus, 'admin');
      if (result.success) {
        await refetch();
      } else {
        const msg = result.guardFailures?.map((g: { reason: string }) => g.reason).join('; ')
          ?? result.error ?? 'Transition failed';
        reportError(new Error(msg), 'Task transition');
      }
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), 'Task transition');
    } finally {
      setTransitioning(null);
    }
  }, [id, refetch]);

  const handlePromptRespond = useCallback(async (promptId: string, responses: QuestionResponse[]) => {
    setResponding(true);
    setPromptError(null);
    try {
      await window.api.prompts.respond(promptId, { answers: responses });
      await refetchPrompts();
      await refetch();
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Failed to submit response');
    } finally {
      setResponding(false);
    }
  }, [refetchPrompts, refetch]);

  if (!task) return null;

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
      {transitionsError && <InlineError message={transitionsError} context="Loading transitions" />}
      <TaskDetailDashboard
        task={task}
        taskId={id}
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
        onPromptRespond={handlePromptRespond}
        onRefetch={refetch}
        onContextRefetch={refetchContext}
      />
    </div>
  );
}

// --- Implementation tab ---
function ImplementationContent({ id }: { id: string }) {
  const { task, refetch } = useTask(id);

  const { data: artifacts } = useIpc<TaskArtifact[]>(
    () => window.api.artifacts.list(id), [id],
  );
  const { data: transitions, refetch: refetchTransitions } = useIpc<Transition[]>(
    () => window.api.tasks.transitions(id), [id, task?.status],
  );
  const { data: contextEntries, refetch: refetchContext } = useIpc<TaskContextEntry[]>(
    () => window.api.tasks.contextEntries(id), [id],
  );

  const [transitioning, setTransitioning] = useState<string | null>(null);

  const handleTransition = useCallback(async (toStatus: string) => {
    setTransitioning(toStatus);
    try {
      const result = await window.api.tasks.transition(id, toStatus, 'admin');
      if (result.success) {
        await refetch();
        await refetchTransitions();
      } else {
        const msg = result.guardFailures?.map((g: { reason: string }) => g.reason).join('; ')
          ?? result.error ?? 'Transition failed';
        reportError(new Error(msg), 'Implementation transition');
      }
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), 'Implementation transition');
    } finally {
      setTransitioning(null);
    }
  }, [id, refetch, refetchTransitions]);

  if (!task) return null;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <ImplementationTab
        taskId={id}
        task={task}
        artifacts={artifacts ?? null}
        transitions={transitions ?? []}
        transitioning={transitioning}
        contextEntries={contextEntries ?? null}
        onTransition={handleTransition}
        onContextAdded={refetchContext}
      />
    </div>
  );
}

// --- Chat tab ---
function ChatContent({ id }: { id: string }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ChatPanel scope={{ type: 'task', id }} />
    </div>
  );
}

// --- Workflow Review tab ---
function ReviewContent({ id }: { id: string }) {
  const { task } = useTask(id);
  const { pipeline } = usePipeline(task?.pipelineId);
  const statusMeta = usePipelineStatusMeta(task, pipeline);

  const { data: contextEntries, refetch: refetchContext } = useIpc<TaskContextEntry[]>(
    () => window.api.tasks.contextEntries(id), [id],
  );
  const { data: agentRuns, refetch: refetchAgentRuns } = useIpc<AgentRun[]>(
    () => window.api.agents.runs(id), [id],
  );

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
      <WorkflowReviewTab
        taskId={id}
        contextEntries={contextEntries ?? null}
        agentRuns={agentRuns ?? null}
        isFinalStatus={statusMeta.isTerminal}
        onReviewTriggered={() => { refetchAgentRuns(); refetchContext(); }}
      />
    </div>
  );
}
