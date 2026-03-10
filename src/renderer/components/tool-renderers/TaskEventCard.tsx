import React from 'react';
import { Button } from '../ui/button';
import { TaskBaseCard } from './TaskBaseCard';
import { useChatActions } from '../chat/ChatActionsContext';
import type { ToolRendererProps } from './types';
import type { Task, TransitionResult } from '../../../shared/types';

function parseTaskResult(result: string): Task | null {
  try {
    const parsed = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id === 'string' && typeof parsed.title === 'string') return parsed as Task;
    return null;
  } catch {
    return null;
  }
}

function parseTransitionResult(result: string): Task | null {
  try {
    const parsed = JSON.parse(result) as TransitionResult;
    if (parsed.success && parsed.task) return parsed.task;
    return null;
  } catch {
    return null;
  }
}

function isCreateTask(toolName: string): boolean {
  return toolName.endsWith('create_task');
}

function resolveTask(toolName: string, result: string): Task | null {
  if (isCreateTask(toolName)) {
    return parseTaskResult(result);
  }
  return parseTransitionResult(result);
}

export function TaskEventCard({ toolUse, toolResult }: ToolRendererProps) {
  const { sendMessage, isStreaming } = useChatActions();
  const creating = isCreateTask(toolUse.toolName);

  if (!toolResult) {
    return (
      <div className="border border-border rounded p-3 my-1 bg-card text-xs text-muted-foreground">
        {creating ? 'Creating task…' : 'Transitioning task…'}
      </div>
    );
  }

  const task = resolveTask(toolUse.toolName, toolResult.result);

  if (!task) {
    let errorMsg = toolResult.result;
    try {
      const parsed = JSON.parse(toolResult.result);
      if (parsed?.error) errorMsg = parsed.error;
    } catch { /* use raw */ }
    return (
      <div className="border border-destructive/40 rounded p-3 my-1 bg-card text-xs text-destructive">
        {creating ? 'Task creation failed: ' : 'Transition failed: '}{errorMsg}
      </div>
    );
  }

  const buttonLabel = creating ? 'Start Planning →' : 'View Task →';
  const buttonMessage = creating
    ? 'Start planning for this task'
    : `Get the full details for task ${task.id}`;

  const transitionNote = !creating && (
    <p className="text-xs text-muted-foreground">
      Transitioned to <span className="font-medium text-foreground">{task.status}</span>
    </p>
  );

  return (
    <TaskBaseCard task={task}>
      {transitionNote}
      <div>
        <Button
          size="sm"
          variant="default"
          disabled={isStreaming}
          onClick={() => sendMessage(buttonMessage)}
        >
          {buttonLabel}
        </Button>
      </div>
    </TaskBaseCard>
  );
}
