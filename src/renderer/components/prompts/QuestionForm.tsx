import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import type { PendingPrompt } from '../../../shared/types';

interface QuestionOption {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
}

interface Question {
  id: string;
  question: string;
  context?: string;
  options?: QuestionOption[];
}

export interface QuestionResponse {
  questionId: string;
  selectedOptionId?: string;
  answer?: string;
  customText?: string;
}

interface QuestionFormProps {
  prompt: PendingPrompt;
  onSubmit: (responses: QuestionResponse[]) => void;
  submitting: boolean;
  error: string | null;
}

export function QuestionForm({ prompt, onSubmit, submitting, error }: QuestionFormProps) {
  const questions = parseQuestions(prompt.payload);
  const [responses, setResponses] = useState<Record<string, QuestionResponse>>(() => {
    const initial: Record<string, QuestionResponse> = {};
    for (const q of questions) {
      initial[q.id] = { questionId: q.id };
    }
    return initial;
  });

  // For choice questions: track whether "custom" radio is selected
  const [customActive, setCustomActive] = useState<Record<string, boolean>>({});
  // For all questions: track whether "add notes" is expanded
  const [notesExpanded, setNotesExpanded] = useState<Record<string, boolean>>({});

  const updateResponse = (qId: string, patch: Partial<QuestionResponse>) => {
    setResponses(prev => ({
      ...prev,
      [qId]: { ...prev[qId], ...patch },
    }));
  };

  const isComplete = questions.every(q => {
    const r = responses[q.id];
    if (q.options && q.options.length > 0) {
      // Choice question: must select an option or provide custom text
      return r?.selectedOptionId || (customActive[q.id] && r?.answer?.trim());
    }
    // Text question: must provide an answer
    return r?.answer?.trim();
  });

  const handleSubmit = () => {
    const result = questions.map(q => responses[q.id]);
    onSubmit(result);
  };

  if (questions.length === 0) {
    // Fallback for prompts without structured questions
    return <FallbackPrompt prompt={prompt} onSubmit={onSubmit} submitting={submitting} error={error} />;
  }

  return (
    <div className="space-y-6">
      {questions.map((q, idx) => (
        <div key={q.id} className="space-y-2">
          <div className="font-medium text-sm">
            {questions.length > 1 && <span className="text-muted-foreground mr-1">{idx + 1}.</span>}
            {q.question}
          </div>
          {q.context && (
            <p className="text-xs text-muted-foreground">{q.context}</p>
          )}

          {q.options && q.options.length > 0 ? (
            <ChoiceQuestion
              question={q}
              response={responses[q.id]}
              isCustom={!!customActive[q.id]}
              onSelectOption={(optId) => {
                setCustomActive(prev => ({ ...prev, [q.id]: false }));
                updateResponse(q.id, { selectedOptionId: optId, answer: undefined });
              }}
              onSelectCustom={() => {
                setCustomActive(prev => ({ ...prev, [q.id]: true }));
                updateResponse(q.id, { selectedOptionId: undefined });
              }}
              onCustomTextChange={(text) => updateResponse(q.id, { answer: text })}
            />
          ) : (
            <Textarea
              value={responses[q.id]?.answer ?? ''}
              onChange={(e) => updateResponse(q.id, { answer: e.target.value })}
              placeholder="Type your answer..."
              rows={2}
            />
          )}

          {/* Notes toggle for choice questions */}
          {q.options && q.options.length > 0 && (
            <div>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => setNotesExpanded(prev => ({ ...prev, [q.id]: !prev[q.id] }))}
              >
                {notesExpanded[q.id] ? 'Hide notes' : 'Add notes'}
              </button>
              {notesExpanded[q.id] && (
                <Textarea
                  className="mt-1"
                  value={responses[q.id]?.customText ?? ''}
                  onChange={(e) => updateResponse(q.id, { customText: e.target.value })}
                  placeholder="Additional notes or context..."
                  rows={2}
                />
              )}
            </div>
          )}
        </div>
      ))}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleSubmit} disabled={submitting || !isComplete}>
        {submitting ? 'Submitting...' : 'Submit Answers'}
      </Button>
    </div>
  );
}

function ChoiceQuestion({
  question,
  response,
  isCustom,
  onSelectOption,
  onSelectCustom,
  onCustomTextChange,
}: {
  question: Question;
  response: QuestionResponse;
  isCustom: boolean;
  onSelectOption: (optId: string) => void;
  onSelectCustom: () => void;
  onCustomTextChange: (text: string) => void;
}) {
  return (
    <div className="space-y-2">
      {question.options!.map(opt => (
        <label
          key={opt.id}
          className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
            response.selectedOptionId === opt.id && !isCustom
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/30'
          }`}
        >
          <input
            type="radio"
            name={`q-${question.id}`}
            checked={response.selectedOptionId === opt.id && !isCustom}
            onChange={() => onSelectOption(opt.id)}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{opt.label}</span>
              {opt.recommended && (
                <Badge variant="secondary" className="text-xs">Recommended</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
          </div>
        </label>
      ))}

      {/* Custom approach option */}
      <label
        className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
          isCustom
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/30'
        }`}
      >
        <input
          type="radio"
          name={`q-${question.id}`}
          checked={isCustom}
          onChange={onSelectCustom}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">Custom approach</span>
          {isCustom && (
            <Textarea
              className="mt-2"
              value={response.answer ?? ''}
              onChange={(e) => onCustomTextChange(e.target.value)}
              placeholder="Describe your preferred approach..."
              rows={2}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      </label>
    </div>
  );
}

/** Fallback for prompts without structured questions (legacy format). */
function FallbackPrompt({
  prompt,
  onSubmit,
  submitting,
  error,
}: {
  prompt: PendingPrompt;
  onSubmit: (responses: QuestionResponse[]) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [answer, setAnswer] = useState('');

  const payload = prompt.payload;
  let questionText = 'The agent needs additional information to proceed.';
  if (Array.isArray(payload.questions)) {
    questionText = payload.questions.map(String).join('\n');
  } else if (typeof payload.question === 'string') {
    questionText = payload.question;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm whitespace-pre-wrap">{questionText}</p>
      <Textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Type your response..."
        rows={3}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        onClick={() => onSubmit([{ questionId: 'fallback', answer }])}
        disabled={submitting || !answer.trim()}
      >
        {submitting ? 'Submitting...' : 'Submit Response'}
      </Button>
    </div>
  );
}

/** Extract structured questions from prompt payload. */
function parseQuestions(payload: Record<string, unknown>): Question[] {
  if (!Array.isArray(payload.questions)) return [];

  return payload.questions
    .filter((q): q is Record<string, unknown> => q != null && typeof q === 'object')
    .filter(q => typeof q.id === 'string' && typeof q.question === 'string')
    .map(q => ({
      id: q.id as string,
      question: q.question as string,
      context: typeof q.context === 'string' ? q.context : undefined,
      options: Array.isArray(q.options)
        ? q.options
            .filter((o): o is Record<string, unknown> => o != null && typeof o === 'object')
            .filter(o => typeof o.id === 'string' && typeof o.label === 'string')
            .map(o => ({
              id: o.id as string,
              label: o.label as string,
              description: typeof o.description === 'string' ? o.description : '',
              recommended: o.recommended === true,
            }))
        : undefined,
    }));
}
