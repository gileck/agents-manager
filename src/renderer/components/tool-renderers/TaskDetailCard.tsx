import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { TaskBaseCard } from './TaskBaseCard';
import { MarkdownContent } from '../chat/MarkdownContent';
import { useChatActions } from '../chat/ChatActionsContext';
import type { ToolRendererProps } from './types';
import type { Task, Transition, TaskDoc } from '../../../shared/types';
import { getPhaseByDocType } from '../../../shared/doc-phases';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';

const AGENT_BUTTONS: { label: string; agentType: string; mode: 'new' | 'revision'; variant: 'default' | 'secondary' | 'outline' }[] = [
  { label: 'Plan', agentType: 'planner', mode: 'new', variant: 'default' },
  { label: 'Implement', agentType: 'implementor', mode: 'new', variant: 'secondary' },
  { label: 'Review', agentType: 'reviewer', mode: 'new', variant: 'outline' },
];

export interface ParseTaskResult {
  task: Task | null;
  /** Non-null when we got valid JSON with some task-like fields but missing id or title */
  partial: Record<string, unknown> | null;
}

export function parseTask(result: string): ParseTaskResult {
  try {
    const parsed = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { task: null, partial: null };
    if (typeof parsed.id === 'string' && typeof parsed.title === 'string') return { task: parsed as Task, partial: null };
    // Valid JSON object but missing required identity fields — return as partial
    return { task: null, partial: parsed as Record<string, unknown> };
  } catch {
    return { task: null, partial: null };
  }
}

/** Resolve docs from either task.docs (new system) or legacy task fields */
function getTaskDocs(task: Task): { label: string; content: string }[] {
  // Prefer docs from the unified task_docs system
  const taskDocs = (task as Task & { docs?: TaskDoc[] }).docs;
  if (taskDocs && taskDocs.length > 0) {
    return taskDocs
      .filter(d => d.content)
      .map(d => ({
        label: getPhaseByDocType(d.type)?.docTitle ?? d.type,
        content: d.content,
      }));
  }
  // Fallback to legacy task columns
  const items: { label: string; content: string }[] = [];
  if (task.plan) items.push({ label: 'Plan', content: task.plan });
  if (task.technicalDesign) items.push({ label: 'Technical Design', content: task.technicalDesign });
  if (task.investigationReport) items.push({ label: 'Investigation Report', content: task.investigationReport });
  return items;
}

interface PlanDesignPanelProps {
  task: Task;
  isStreaming: boolean;
  sendMessage: (text: string) => void;
}

function PlanDesignPanel({ task, isStreaming, sendMessage }: PlanDesignPanelProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [contentExpanded, setContentExpanded] = useState(false);

  const docItems = getTaskDocs(task);
  const [activeTab, setActiveTab] = useState<string>(docItems[0]?.label ?? '');
  const showTabs = docItems.length > 1;

  const subtaskCount = task.subtasks?.length ?? 0;
  const phaseCount = task.phases?.length ?? 0;

  function handleApprove() {
    sendMessage(`I approve the plan for task ${task.id}, proceed to implementation`);
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
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            {docItems.length === 1 ? docItems[0].label : `Docs (${docItems.length})`}
          </span>
          {(subtaskCount > 0 || phaseCount > 0) && (
            <span className="text-[10px] text-muted-foreground">
              {subtaskCount > 0 && `${subtaskCount} subtask${subtaskCount !== 1 ? 's' : ''}`}
              {subtaskCount > 0 && phaseCount > 0 && ' · '}
              {phaseCount > 0 && `${phaseCount} phase${phaseCount !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          onClick={() => setContentExpanded((v) => !v)}
        >
          {contentExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {contentExpanded && (
        showTabs ? (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-7">
              {docItems.map(item => (
                <TabsTrigger key={item.label} value={item.label} className="text-xs h-6 px-2">{item.label}</TabsTrigger>
              ))}
            </TabsList>
            {docItems.map(item => (
              <TabsContent key={item.label} value={item.label}>
                <div className="text-xs prose-sm max-h-64 overflow-y-auto border border-border/40 rounded p-2 bg-muted/30">
                  <MarkdownContent content={item.content} />
                </div>
              </TabsContent>
            ))}
          </Tabs>
        ) : docItems.length === 1 ? (
          <div className="text-xs prose-sm max-h-64 overflow-y-auto border border-border/40 rounded p-2 bg-muted/30">
            <MarkdownContent content={docItems[0].content} />
          </div>
        ) : null
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
      .then((result) => setTransitions(result.transitions))
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
          if (agentType === 'implementor') return task.plan != null || getTaskDocs(task).length > 0;
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

      {/* Inline docs panel when any doc content exists */}
      {getTaskDocs(task).length > 0 && (
        <PlanDesignPanel
          task={task}
          isStreaming={isStreaming}
          sendMessage={sendMessage}
        />
      )}
    </TaskBaseCard>
  );
}

function PartialTaskView({ data }: { data: Record<string, unknown> }) {
  const displayFields = Object.entries(data).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  return (
    <div className="border border-border rounded p-3 my-1 bg-card space-y-1">
      <p className="text-xs text-muted-foreground italic">Partial task data (missing id or title)</p>
      {displayFields.map(([key, value]) => (
        <div key={key} className="text-xs">
          <span className="font-medium text-foreground">{key}:</span>{' '}
          <span className="text-muted-foreground">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
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

  const { task, partial } = parseTask(toolResult.result);

  if (task) {
    return <TaskDetailBody task={task} />;
  }

  if (partial) {
    return <PartialTaskView data={partial} />;
  }

  return (
    <div className="border border-destructive/40 rounded p-3 my-1 bg-card text-xs text-destructive">
      Failed to load task: {toolResult.result}
    </div>
  );
}
