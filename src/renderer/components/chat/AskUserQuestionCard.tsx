import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { AgentChatMessageAskUserQuestion, AskUserQuestionItem } from '../../../shared/types';
import { CheckCircle2, Circle, Square, CheckSquare, Send, Star } from 'lucide-react';

interface AskUserQuestionCardProps {
  message: AgentChatMessageAskUserQuestion;
  onAnswer: (questionId: string, answers: Record<string, string>) => Promise<void> | void;
}

/** Check whether an option label contains "(Recommended)" suffix. */
function isRecommended(label: string): boolean {
  return /\(Recommended\)\s*$/i.test(label);
}

/** Strip the "(Recommended)" suffix for display (badge is rendered separately). */
function stripRecommended(label: string): string {
  return label.replace(/\s*\(Recommended\)\s*$/i, '').trim();
}

/**
 * Heuristic: use compact pill-button mode when:
 * - Single question
 * - Single-select (not multiSelect)
 * - All option labels are short (< 25 chars)
 * - No option has a description
 */
function shouldUseCompactMode(questions: AskUserQuestionItem[]): boolean {
  if (questions.length !== 1) return false;
  const q = questions[0];
  if (q.multiSelect) return false;
  return q.options.every(
    (opt) => opt.label.length < 25 && !opt.description,
  );
}

// ─── Compact Pill Mode ────────────────────────────────────────────────────────

interface CompactPillModeProps {
  question: AskUserQuestionItem;
  questionId: string;
  onAnswer: (questionId: string, answers: Record<string, string>) => Promise<void> | void;
}

function CompactPillMode({ question, questionId, onAnswer }: CompactPillModeProps) {
  const [submitting, setSubmitting] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [showOtherInput, setShowOtherInput] = useState(false);
  const otherInputRef = useRef<HTMLInputElement>(null);

  const submitAnswer = useCallback(async (answer: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onAnswer(questionId, { [question.question]: answer });
    } catch {
      setSubmitting(false);
    }
  }, [submitting, questionId, question.question, onAnswer]);

  const handleOtherSubmit = useCallback(() => {
    const trimmed = otherText.trim();
    if (trimmed) {
      submitAnswer(trimmed);
    }
  }, [otherText, submitAnswer]);

  const handleOtherKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleOtherSubmit();
    }
  }, [handleOtherSubmit]);

  useEffect(() => {
    if (showOtherInput && otherInputRef.current) {
      otherInputRef.current.focus();
    }
  }, [showOtherInput]);

  return (
    <div className="my-2">
      {question.header && (
        <div className="text-xs font-medium text-muted-foreground mb-1">{question.header}</div>
      )}
      <div className="text-sm font-medium text-foreground mb-2">{question.question}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {question.options.map((opt, i) => {
          const recommended = isRecommended(opt.label);
          const displayLabel = recommended ? stripRecommended(opt.label) : opt.label;

          return (
            <button
              key={i}
              type="button"
              disabled={submitting}
              onClick={() => submitAnswer(opt.label)}
              className={`inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                recommended
                  ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                  : 'bg-background text-foreground border-border hover:border-primary/50 hover:bg-accent/50'
              }`}
            >
              {recommended && <Star className="h-3 w-3 fill-current" />}
              {displayLabel}
            </button>
          );
        })}
        {/* Other... pill */}
        {!showOtherInput && (
          <button
            type="button"
            disabled={submitting}
            onClick={() => setShowOtherInput(true)}
            className="inline-flex items-center px-3 py-1 text-sm rounded-full border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Other...
          </button>
        )}
        {showOtherInput && (
          <div className="inline-flex items-center gap-1">
            <input
              ref={otherInputRef}
              type="text"
              placeholder="Type your answer..."
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={handleOtherKeyDown}
              disabled={submitting}
              className="text-sm px-2 py-1 rounded-full border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-40"
            />
            <button
              type="button"
              disabled={submitting || !otherText.trim()}
              onClick={handleOtherSubmit}
              className="inline-flex items-center px-2 py-1 text-sm rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Compact Answered State ───────────────────────────────────────────────────

interface CompactAnsweredProps {
  question: AskUserQuestionItem;
  answer: string;
}

function CompactAnswered({ question, answer }: CompactAnsweredProps) {
  return (
    <div className="my-2 flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">{question.header || question.question}</span>
      <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-sm px-2.5 py-0.5 rounded-full">
        <CheckCircle2 className="h-3 w-3" />
        {answer}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AskUserQuestionCard({ message, onAnswer }: AskUserQuestionCardProps) {
  const { questionId, questions, answered, answers: existingAnswers } = message;
  const compact = shouldUseCompactMode(questions);

  // selections: questionIndex -> selected option label(s)
  const [selections, setSelections] = useState<Map<number, Set<string>>>(new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

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

  // Enter key handler for full card mode
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && allAnswered && !submitting) {
      // Only submit if the card itself (or a non-input child) is focused
      const target = e.target as HTMLElement;
      const isTextInput = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text';
      // If Enter is pressed in the Other... input, submit it
      if (isTextInput) {
        e.preventDefault();
        handleSubmit();
        return;
      }
      // If Enter is pressed on a button or the card container, submit
      if (target.tagName === 'BUTTON' || target === cardRef.current) {
        e.preventDefault();
        handleSubmit();
      }
    }
  }, [allAnswered, submitting, handleSubmit]);

  // ─── Compact answered state ────────────────────────────────────────────────
  if (answered && existingAnswers && compact) {
    return <CompactAnswered question={questions[0]} answer={existingAnswers[questions[0].question] || '(no answer)'} />;
  }

  // ─── Full answered state ───────────────────────────────────────────────────
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

  // ─── Compact unanswered: pill buttons ──────────────────────────────────────
  if (compact) {
    return <CompactPillMode question={questions[0]} questionId={questionId} onAnswer={onAnswer} />;
  }

  // ─── Full card mode ────────────────────────────────────────────────────────
  return (
    <div
      ref={cardRef}
      className="my-3 border border-border rounded-lg p-4 bg-card"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
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
              const recommended = isRecommended(opt.label);

              return (
                <button
                  key={oIndex}
                  type="button"
                  onClick={() => toggleOption(qIndex, opt.label, isMulti)}
                  className={`w-full flex items-start gap-2.5 text-left px-3 py-2 rounded-md border transition-colors ${
                    selected
                      ? 'border-primary bg-primary/5 text-foreground'
                      : recommended
                        ? 'border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10 text-foreground'
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
                    <span className="text-sm flex items-center gap-1.5">
                      {recommended ? stripRecommended(opt.label) : opt.label}
                      {recommended && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          <Star className="h-3 w-3 fill-primary" />
                          Recommended
                        </span>
                      )}
                    </span>
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

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="h-3.5 w-3.5" />
          {submitting ? 'Submitting...' : 'Submit Answers'}
        </button>
        {allAnswered && !submitting && (
          <span className="text-xs text-muted-foreground">Press Enter to submit</span>
        )}
      </div>
    </div>
  );
}
