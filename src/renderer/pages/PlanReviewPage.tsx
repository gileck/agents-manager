import React, { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { InlineError } from '../components/InlineError';
import { TaskSubPageLayout } from '../components/task-detail/TaskSubPageLayout';
import { PlanMarkdown } from '../components/task-detail/PlanMarkdown';
import { ReviewConversation } from '../components/plan/ReviewConversation';
import { useReviewConversation } from '../hooks/useReviewConversation';
import { useTask } from '../hooks/useTasks';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { reportError } from '../lib/error-handler';
import type { Transition, TaskContextEntry } from '../../shared/types';

const CONFIG = {
  plan: {
    field: 'plan' as const,
    entryType: 'plan_feedback',
    agentRole: 'planner',
    approveToStatus: 'implementing',
    reviseToStatus: 'planning',
    reviewStatus: 'plan_review',
    label: 'Plan',
    tabKey: 'plan',
  },
  design: {
    field: 'technicalDesign' as const,
    entryType: 'design_feedback',
    agentRole: 'designer',
    approveToStatus: 'implementing',
    reviseToStatus: 'designing',
    reviewStatus: 'design_review',
    label: 'Technical Design',
    tabKey: 'design',
  },
};

interface PlanReviewPageProps {
  reviewType: 'plan' | 'design';
}

export function PlanReviewPage({ reviewType }: PlanReviewPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const cfg = CONFIG[reviewType];
  const [transitioning, setTransitioning] = useState(false);
  const [chatOpen, setChatOpen] = useLocalStorage('planReview.chatOpen', true);

  const { task, refetch } = useTask(id!);

  const { data: transitions, refetch: refetchTransitions, error: transitionsError } = useIpc<Transition[]>(
    () => id ? window.api.tasks.transitions(id) : Promise.resolve([]),
    [id, task?.status],
  );

  const { data: contextEntries, refetch: refetchContext, error: entriesError } = useIpc<TaskContextEntry[]>(
    () => id ? window.api.tasks.contextEntries(id) : Promise.resolve([]),
    [id],
  );

  const entries = (contextEntries ?? []).filter(e => e.entryType === cfg.entryType);
  const content = task ? task[cfg.field] as string | null : null;
  const isReviewStatus = task?.status === cfg.reviewStatus;

  const approveTransition = (transitions ?? []).find(t => t.to === cfg.approveToStatus);
  const reviseTransition = (transitions ?? []).find(t => t.to === cfg.reviseToStatus);

  const { streamingMessages, isStreaming, sendMessage, stopChat } = useReviewConversation(
    id, cfg.agentRole, cfg.entryType, refetchContext,
  );

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
      const feedbackContent = comment.trim() || `User requested changes to the ${cfg.label.toLowerCase()}.`;
      await window.api.tasks.addFeedback(id, { entryType: cfg.entryType, content: feedbackContent });
      await refetchContext();
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), 'Save review feedback');
      return;
    }
    await handleTransition(toStatus);
  }, [id, cfg.entryType, cfg.label, refetchContext, handleTransition]);

  const chatToggleButton = (
    <Button
      variant={chatOpen ? 'secondary' : 'outline'}
      size="sm"
      onClick={() => setChatOpen(!chatOpen)}
      title="Toggle chat panel"
    >
      <MessageSquare size={16} />
      {chatOpen ? 'Chat' : 'Chat & Review'}
    </Button>
  );

  const actionButtons = isReviewStatus ? (
    <>
      {approveTransition && (
        <Button size="sm" disabled={transitioning} onClick={() => handleFeedbackAction(approveTransition.to, '')}>
          {transitioning ? 'Submitting...' : approveTransition.label || 'Approve & Implement'}
        </Button>
      )}
      {chatToggleButton}
    </>
  ) : chatToggleButton;

  return (
    <TaskSubPageLayout taskId={id!} tabLabel={`${cfg.label} Review`} tabKey={cfg.tabKey} actions={actionButtons}>
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
          {content ? (
            <PlanMarkdown content={content} />
          ) : (
            <p className="text-sm text-muted-foreground">No {cfg.label.toLowerCase()} content available yet.</p>
          )}
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
            entries={entries}
            isReviewStatus={isReviewStatus}
            streamingMessages={streamingMessages}
            isStreaming={isStreaming}
            onSend={sendMessage}
            onStop={stopChat}
            onRequestChanges={reviseTransition ? (comment) => handleFeedbackAction(reviseTransition.to, comment ?? '') : undefined}
            requestingChanges={transitioning}
            hasConversation={entries.length > 0}
            placeholder={`Ask about the ${cfg.label.toLowerCase()} or request changes...`}
          />
        </div>
      </div>
    </TaskSubPageLayout>
  );
}
