import React, { useState, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { QuestionForm } from './QuestionForm';
import type { PendingPrompt, Task } from '../../../shared/types';
import type { QuestionResponse } from './QuestionForm';

interface AnswerQuestionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  pendingPrompts: PendingPrompt[];
  onSubmit: (promptId: string, responses: QuestionResponse[]) => Promise<void>;
  responding: boolean;
  error: string | null;
}

export function AnswerQuestionsDialog({
  open,
  onOpenChange,
  task,
  pendingPrompts,
  onSubmit,
  responding,
  error,
}: AnswerQuestionsDialogProps) {
  const [confirmed, setConfirmed] = useState(false);
  const confirmedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePendingPrompts = pendingPrompts.filter((p) => p.status === 'pending');

  const handleSubmit = async (promptId: string, responses: QuestionResponse[]) => {
    await onSubmit(promptId, responses);
    setConfirmed(true);
    confirmedTimerRef.current = setTimeout(() => {
      setConfirmed(false);
      onOpenChange(false);
    }, 2000);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && confirmedTimerRef.current) {
      clearTimeout(confirmedTimerRef.current);
      confirmedTimerRef.current = null;
      setConfirmed(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agent needs your input</DialogTitle>
          <p className="text-sm text-muted-foreground truncate">{task.title}</p>
        </DialogHeader>

        {confirmed ? (
          <div className="py-8 text-center">
            <p className="text-green-600 font-medium text-base">✅ Agent is resuming…</p>
          </div>
        ) : activePendingPrompts.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-muted-foreground">No pending questions.</p>
          </div>
        ) : (
          <div className="space-y-8 py-2">
            {activePendingPrompts.map((prompt) => (
              <div key={prompt.id}>
                {prompt.promptType && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    {prompt.promptType}
                  </p>
                )}
                <QuestionForm
                  prompt={prompt}
                  onSubmit={(responses) => handleSubmit(prompt.id, responses)}
                  submitting={responding}
                  error={error}
                />
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
