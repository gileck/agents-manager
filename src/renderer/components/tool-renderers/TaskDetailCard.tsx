import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { TaskBaseCard } from './TaskBaseCard';
import { MarkdownContent } from '../chat/MarkdownContent';
import { useChatActions } from '../chat/ChatActionsContext';
import type { ToolRendererProps } from './types';
import type { Task, Transition } from '../../../shared/types';

const AGENT_BUTTONS: { label: string; agentType: string; mode: 'new' | 'revision'; variant: 'default' | 'secondary' | 'outline' }[] = [
  { label: 'Plan', agentType: 'planner', mode: 'new', variant: 'default' },
  { label: 'Implement', agentType: 'implementor', mode: 'new', variant: 'secondary' },
  { label: 'Review', agentType: 'reviewer', mode: 'new', variant: 'outline' },
];

function parseTask(result: string): Task | null {
  try {
    const parsed = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id === 'string' && typeof parsed.title === 'string') return parsed as Task;
    return null;
  } catch {
    return null;
  }
}

interface PlanReviewPanelProps {
  plan: string;
  taskId: string;
  isStreaming: boolean;
  sendMessage: (text: string) => void;
}

function PlanReviewPanel({ plan, taskId, isStreaming, sendMessage }: PlanReviewPanelProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [planExpanded, setPlanExpanded] = useState(false);

  function handleApprove() {
    sendMessage(`I approve the plan for task ${taskId}, proceed to implementation`);
  }

  function handleSubmitFeedback() {
    if (!feedback.trim()) return;
    sendMessage(feedback.trim());
    setFeedback('');
    setShowFeedback(false);
  }

  return (
    <div className="border-t border-border/60 pt-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Plan</span>
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          onClick={() => setPlanExpanded((v) => !v)}
        >
          {planExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {planExpanded && (
        <div className="text-xs prose-sm max-h-64 overflow-y-auto border border-border/40 rounded p-2 bg-muted/30">
          <MarkdownContent content={plan} />
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="default"
          disabled={isStreaming}
          onClick={handleApprove}
        >
          Approve Plan
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isStreaming}
          onClick={() => setShowFeedback((v) => !v)}
        >
          Request Changes
        </Button>
      </div>
      {showFeedback && (
        <div className="space-y-1.5">
          <textarea
            className="w-full text-xs border border-border rounded p-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
            placeholder="Describe the changes needed…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="default"
              disabled={isStreaming || !feedback.trim()}
              onClick={handleSubmitFeedback}
            >
              Send Feedback
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowFeedback(false); setFeedback(''); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface TaskDetailBodyProps {
  task: Task;
}

function TaskDetailBody({ task }: TaskDetailBodyProps) {
  const { sendMessage, isStreaming } = useChatActions();
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [transitionsError, setTransitionsError] = useState<string | null>(null);
  const [transitionLoading, setTransitionLoading] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    window.api.tasks.transitions(task.id)
      .then((result) => setTransitions(result))
      .catch(() => setTransitionsError('Transitions unavailable'));
  }, [task.id]);

  async function handleTransition(toStatus: string) {
    setTransitionLoading(toStatus);
    setActionError(null);
    try {
      await window.api.tasks.transition(task.id, toStatus);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setTransitionLoading(null);
    }
  }

  async function handleAgentStart(agentType: string, mode: 'new' | 'revision') {
    setAgentLoading(agentType);
    setActionError(null);
    try {
      await window.api.agents.start(task.id, mode, agentType);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start agent');
    } finally {
      setAgentLoading(null);
    }
  }

  return (
    <TaskBaseCard task={task}>
      {/* Transition buttons */}
      {transitionsError ? (
        <p className="text-xs text-muted-foreground">{transitionsError}</p>
      ) : transitions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {transitions.map((t) => (
            <Button
              key={t.to}
              size="sm"
              variant="outline"
              disabled={transitionLoading !== null || agentLoading !== null}
              onClick={() => handleTransition(t.to)}
            >
              {transitionLoading === t.to ? 'Moving…' : (t.label || t.to)}
            </Button>
          ))}
        </div>
      )}

      {/* Agent action buttons — filtered by task state */}
      <div className="flex flex-wrap gap-1.5">
        {AGENT_BUTTONS.filter(({ agentType }) => {
          if (agentType === 'implementor') return task.plan != null;
          return true;
        }).map(({ label, agentType, mode, variant }) => (
          <Button
            key={agentType}
            size="sm"
            variant={variant}
            disabled={agentLoading !== null || transitionLoading !== null}
            onClick={() => handleAgentStart(agentType, mode)}
          >
            {agentLoading === agentType ? 'Starting…' : label}
          </Button>
        ))}
      </div>

      {/* Inline error */}
      {actionError && (
        <p className="text-xs text-destructive">{actionError}</p>
      )}

      {/* Inline plan review panel when a plan exists */}
      {task.plan && (
        <PlanReviewPanel
          plan={task.plan}
          taskId={task.id}
          isStreaming={isStreaming}
          sendMessage={sendMessage}
        />
      )}
    </TaskBaseCard>
  );
}

export function TaskDetailCard({ toolResult }: ToolRendererProps) {
  if (!toolResult) {
    return (
      <div className="border border-border rounded p-3 my-1 bg-card text-xs text-muted-foreground">
        Loading task…
      </div>
    );
  }

  const task = parseTask(toolResult.result);

  if (!task) {
    return (
      <div className="border border-destructive/40 rounded p-3 my-1 bg-card text-xs text-destructive">
        Failed to load task: {toolResult.result}
      </div>
    );
  }

  return <TaskDetailBody task={task} />;
}
