import React, { useState, useCallback } from 'react';
import type { AgentChatMessageAskUserQuestion } from '../../../shared/types';
import { CheckCircle2, Circle, Square, CheckSquare, Send } from 'lucide-react';

interface AskUserQuestionCardProps {
  message: AgentChatMessageAskUserQuestion;
  onAnswer: (questionId: string, answers: Record<string, string>) => Promise<void> | void;
}

export function AskUserQuestionCard({ message, onAnswer }: AskUserQuestionCardProps) {
  const { questionId, questions, answered, answers: existingAnswers } = message;

  // selections: questionIndex -> selected option label(s)
  const [selections, setSelections] = useState<Map<number, Set<string>>>(new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const toggleOption = useCallback((qIndex: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(qIndex) ?? new Set<string>();
      const updated = new Set(current);

      if (multiSelect) {
        if (updated.has(label)) updated.delete(label);
        else updated.add(label);
      } else {
        updated.clear();
        updated.add(label);
      }

      // Clear "Other" text if an option is selected and not multi
      if (!multiSelect) {
        setOtherTexts((p) => { const n = new Map(p); n.delete(qIndex); return n; });
      }

      next.set(qIndex, updated);
      return next;
    });
  }, []);

  const setOtherText = useCallback((qIndex: number, text: string) => {
    setOtherTexts((prev) => {
      const next = new Map(prev);
      next.set(qIndex, text);
      return next;
    });
  }, []);

  const allAnswered = questions.every((q, i) => {
    const selected = selections.get(i);
    const other = otherTexts.get(i);
    return (selected && selected.size > 0) || (other && other.trim().length > 0);
  });

  const handleSubmit = useCallback(async () => {
    if (!allAnswered || submitting) return;
    setSubmitting(true);

    const answerMap: Record<string, string> = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const selected = selections.get(i);
      const other = otherTexts.get(i)?.trim();
      const parts: string[] = [];
      if (selected) parts.push(...selected);
      if (other) parts.push(other);
      answerMap[q.question] = parts.join(', ');
    }

    try {
      await onAnswer(questionId, answerMap);
    } catch {
      setSubmitting(false);
    }
  }, [allAnswered, submitting, questions, selections, otherTexts, questionId, onAnswer]);

  // Answered state: read-only view
  if (answered && existingAnswers) {
    return (
      <div className="my-3 border border-border rounded-lg p-4 bg-card/50">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-foreground/80">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          Questions Answered
        </div>
        {questions.map((q, i) => (
          <div key={i} className="mb-2 last:mb-0">
            <div className="text-xs text-muted-foreground mb-1">{q.header || q.question}</div>
            <div className="inline-flex items-center gap-1 bg-primary/10 text-primary text-sm px-2 py-0.5 rounded">
              {existingAnswers[q.question] || '(no answer)'}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="my-3 border border-border rounded-lg p-4 bg-card">
      {questions.map((q, qIndex) => (
        <div key={qIndex} className="mb-4 last:mb-2">
          {q.header && (
            <div className="text-xs font-medium text-muted-foreground mb-1">{q.header}</div>
          )}
          <div className="text-sm font-medium text-foreground mb-2">{q.question}</div>
          <div className="space-y-1.5">
            {q.options.map((opt, oIndex) => {
              const selected = selections.get(qIndex)?.has(opt.label) ?? false;
              const isMulti = q.multiSelect ?? false;

              return (
                <button
                  key={oIndex}
                  type="button"
                  onClick={() => toggleOption(qIndex, opt.label, isMulti)}
                  className={`w-full flex items-start gap-2.5 text-left px-3 py-2 rounded-md border transition-colors ${
                    selected
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border hover:border-primary/40 hover:bg-accent/40 text-foreground/80'
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    {isMulti ? (
                      selected
                        ? <CheckSquare className="h-4 w-4 text-primary" />
                        : <Square className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      selected
                        ? <CheckCircle2 className="h-4 w-4 text-primary" />
                        : <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-sm">{opt.label}</span>
                    {opt.description && (
                      <span className="block text-xs text-muted-foreground mt-0.5">{opt.description}</span>
                    )}
                  </span>
                </button>
              );
            })}
            {/* Other text input */}
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                placeholder="Other..."
                value={otherTexts.get(qIndex) ?? ''}
                onChange={(e) => setOtherText(qIndex, e.target.value)}
                className="flex-1 text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!allAnswered || submitting}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Send className="h-3.5 w-3.5" />
        {submitting ? 'Submitting...' : 'Submit Answers'}
      </button>
    </div>
  );
}
