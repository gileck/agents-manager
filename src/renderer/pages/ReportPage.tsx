import React, { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { InlineError } from '../components/InlineError';
import { TaskSubPageLayout } from '../components/task-detail/TaskSubPageLayout';
import { PlanMarkdown } from '../components/task-detail/PlanMarkdown';
import { ReviewConversation } from '../components/plan/ReviewConversation';
import { PostMortemReport } from '../components/reports/PostMortemReport';
import { WorkflowReviewReport } from '../components/reports/WorkflowReviewReport';
import { useReviewConversation } from '../hooks/useReviewConversation';
import { useTask } from '../hooks/useTasks';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { reportError } from '../lib/error-handler';
import type { Transition, TaskContextEntry } from '../../shared/types';
import type { PostMortemData } from '../components/reports/PostMortemReport';
import type { ReviewData } from '../components/reports/WorkflowReviewReport';
import type { ReportPageConfig } from './reportConfigs';

// ─── Component ────────────────────────────────────────────────────────────────

interface ReportPageProps {
  config: ReportPageConfig;
}

export function ReportPage({ config }: ReportPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [transitioning, setTransitioning] = useState(false);
  const [chatOpen, setChatOpen] = useLocalStorage(config.chatStorageKey, true);

  const { task, refetch } = useTask(id!);

  const { data: transitions, refetch: refetchTransitions, error: transitionsError } = useIpc<Transition[]>(
    () => id ? window.api.tasks.transitions(id) : Promise.resolve([]),
    [id, task?.status],
  );

  const { data: contextEntries, refetch: refetchContext, error: entriesError } = useIpc<TaskContextEntry[]>(
    () => id ? window.api.tasks.contextEntries(id) : Promise.resolve([]),
    [id],
  );

  // ─── Resolve content based on config ──────────────────────────────────────

  let content: string | null = null;
  let data: unknown = null;
  let contextEntryCreatedAt: number | undefined;

  if (config.contentSource.type === 'taskField') {
    content = task ? (task[config.contentSource.field] as string | null) : null;
  } else {
    // contextEntry source: find the most recent entry of the specified type
    const { entryType: sourceEntryType } = config.contentSource;
    const entry = (contextEntries ?? [])
      .filter(e => e.entryType === sourceEntryType)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    data = entry?.data ?? null;
    contextEntryCreatedAt = entry?.createdAt;
  }

  const hasContent = config.contentSource.type === 'taskField' ? !!content : !!data;

  // ─── Review status ────────────────────────────────────────────────────────

  // For task-field reports, check if task is in review status.
  // For context-entry reports (post-mortem, workflow-review), always enable chat when data exists.
  const isReviewStatus = config.reviewStatus
    ? task?.status === config.reviewStatus
    : hasContent;

  // ─── Transitions ──────────────────────────────────────────────────────────

  const approveTransition = config.approveToStatus
    ? (transitions ?? []).find(t => t.to === config.approveToStatus)
    : undefined;
  const reviseTransition = config.reviseToStatus
    ? (transitions ?? []).find(t => t.to === config.reviseToStatus)
    : undefined;

  // ─── Chat ─────────────────────────────────────────────────────────────────

  const chatEntries = (contextEntries ?? []).filter(e => e.entryType === config.entryType);

  const { streamingMessages, isStreaming, sendMessage, stopChat } = useReviewConversation(
    id, config.agentRole, config.entryType, refetchContext,
  );

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleTransition = useCallback(async (toStatus: string) => {
    if (!id) return;
    setTransitioning(true);
    try {
      const result = await window.api.tasks.transition(id, toStatus, 'admin');
      if (result.success) {
        await refetch();
        await refetchTransitions();
        navigate(`/tasks/${id}`);
      } else {
        const msg = result.guardFailures?.map((g: { reason: string }) => g.reason).join('; ')
          ?? result.error ?? 'Transition failed';
        reportError(new Error(msg), 'Review transition');
      }
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), 'Review transition');
    } finally {
      setTransitioning(false);
    }
  }, [id, refetch, refetchTransitions, navigate]);

  const handleFeedbackAction = useCallback(async (toStatus: string, comment: string) => {
    if (!id) return;
    try {
      const feedbackContent = comment.trim() || `User requested changes to the ${config.label.toLowerCase()}.`;
      await window.api.tasks.addFeedback(id, { entryType: config.entryType, content: feedbackContent });
      await refetchContext();
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), 'Save review feedback');
      return;
    }
    await handleTransition(toStatus);
  }, [id, config.entryType, config.label, refetchContext, handleTransition]);

  // ─── Render left panel content ────────────────────────────────────────────

  function renderLeftPanel(): React.ReactNode {
    if (!hasContent) {
      return (
        <p className="text-sm text-muted-foreground">{config.emptyMessage}</p>
      );
    }

    switch (config.renderer) {
      case 'markdown':
        return <PlanMarkdown content={content!} />;
      case 'post-mortem':
        return (
          <PostMortemReport
            data={data as PostMortemData}
            taskId={id!}
            onTaskCreated={refetchContext}
          />
        );
      case 'workflow-review':
        return (
          <WorkflowReviewReport
            data={data as ReviewData}
            reviewedAt={contextEntryCreatedAt}
          />
        );
      default:
        return <p className="text-sm text-muted-foreground">Unknown report renderer.</p>;
    }
  }

  // ─── Action buttons ───────────────────────────────────────────────────────

  const chatToggleButton = (
    <Button
      variant={chatOpen ? 'secondary' : 'outline'}
      size="sm"
      onClick={() => setChatOpen(!chatOpen)}
      title="Toggle chat panel"
    >
      <MessageSquare size={16} />
      {chatOpen ? 'Chat' : 'Chat'}
    </Button>
  );

  const actionButtons = isReviewStatus && approveTransition ? (
    <>
      <Button size="sm" disabled={transitioning} onClick={() => handleFeedbackAction(approveTransition.to, '')}>
        {transitioning ? 'Submitting...' : approveTransition.label || 'Approve & Implement'}
      </Button>
      {chatToggleButton}
    </>
  ) : chatToggleButton;

  // ─── Layout ───────────────────────────────────────────────────────────────

  return (
    <TaskSubPageLayout taskId={id!} tabLabel={`${config.label} Review`} tabKey={config.tabKey} actions={actionButtons}>
      {transitionsError && <InlineError message={transitionsError} context="Loading review transitions" />}
      {entriesError && <InlineError message={entriesError} context="Loading review comments" />}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left panel — content */}
        <div style={{
          width: chatOpen ? '60%' : '100%',
          borderRight: chatOpen ? '1px solid var(--border)' : 'none',
          overflowY: 'auto',
          padding: '24px',
          transition: 'width var(--motion-slow) var(--ease-standard)',
        }}>
          {renderLeftPanel()}
        </div>

        {/* Right panel — conversation */}
        <div style={{
          width: chatOpen ? '40%' : '0',
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width var(--motion-slow) var(--ease-standard)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 8px 0' }}>
            <Button variant="ghost" size="sm" onClick={() => setChatOpen(false)} title="Close chat panel">
              <X size={16} />
            </Button>
          </div>
          <ReviewConversation
            entries={chatEntries}
            isReviewStatus={isReviewStatus}
            streamingMessages={streamingMessages}
            isStreaming={isStreaming}
            onSend={sendMessage}
            onStop={stopChat}
            onRequestChanges={reviseTransition ? (comment) => handleFeedbackAction(reviseTransition.to, comment ?? '') : undefined}
            requestingChanges={transitioning}
            hasConversation={chatEntries.length > 0}
            placeholder={config.chatPlaceholder}
          />
        </div>
      </div>
    </TaskSubPageLayout>
  );
}
