import React from 'react';
import type { ToolRendererProps } from './types';
import { ToolResultPreview } from './ToolResultPreview';

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options?: QuestionOption[];
}

function parseSummary(input: string): { questions: Question[]; headerText: string } {
  try {
    const parsed = JSON.parse(input);
    const questions: Question[] = Array.isArray(parsed.questions) ? parsed.questions : [];
    if (questions.length === 0) {
      return { questions: [], headerText: 'Question' };
    }
    if (questions.length === 1) {
      const q = questions[0];
      const text = q.question || q.header || 'Question';
      return { questions, headerText: text.length > 80 ? text.slice(0, 80) + '...' : text };
    }
    return { questions, headerText: `${questions.length} questions` };
  } catch { /* fallback */ }
  return { questions: [], headerText: 'Question' };
}

export function AskUserQuestionRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const { questions, headerText } = parseSummary(toolUse.input);

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left font-mono"
        onClick={onToggle}
      >
        <span className="text-pink-500">Question</span>
        <span className="text-muted-foreground truncate">{headerText}</span>
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <>
          {questions.length > 0 && (
            <div className="border-t border-border px-3 py-2 space-y-3">
              {questions.map((q, i) => (
                <div key={i} className="text-xs">
                  <div className="text-foreground font-medium mb-1">{q.question}</div>
                  {q.options && q.options.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {q.options.map((opt, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px]"
                          title={opt.description}
                        >
                          {opt.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <ToolResultPreview toolUse={toolUse} toolResult={toolResult} />
        </>
      )}
    </div>
  );
}
