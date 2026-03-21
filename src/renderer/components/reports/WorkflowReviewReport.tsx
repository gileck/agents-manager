import React from 'react';
import { Badge } from '../ui/badge';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewFinding {
  category: string;
  severity: string;
  title: string;
  detail: string;
}

interface SuggestedTask {
  title: string;
  description: string;
  priority?: number;
}

export interface ReviewData {
  verdict?: string;
  executionSummary?: string;
  findings?: ReviewFinding[];
  promptImprovements?: string[];
  processImprovements?: string[];
  tokenCostAnalysis?: string;
  suggestedTasks?: SuggestedTask[];
}

// ─── Colour maps ─────────────────────────────────────────────────────────────

const VERDICT_COLORS: Record<string, { bg: string; text: string }> = {
  good: { bg: '#16a34a', text: 'white' },
  needs_improvement: { bg: '#ca8a04', text: 'white' },
  problematic: { bg: '#dc2626', text: 'white' },
};

const SEVERITY_COLORS: Record<string, string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#dc2626',
};

const CATEGORY_COLORS: Record<string, string> = {
  efficiency: '#8b5cf6',
  infrastructure: '#3b82f6',
  process: '#06b6d4',
  error_handling: '#f97316',
  cost: '#10b981',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface WorkflowReviewReportProps {
  data: ReviewData;
  reviewedAt?: number;
}

export function WorkflowReviewReport({ data, reviewedAt }: WorkflowReviewReportProps) {
  return (
    <div className="space-y-6">
      {/* Verdict badge */}
      {data.verdict && (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Verdict:</span>
          <span
            className="px-3 py-1 rounded-full text-sm font-semibold"
            style={{
              backgroundColor: VERDICT_COLORS[data.verdict]?.bg ?? '#6b7280',
              color: VERDICT_COLORS[data.verdict]?.text ?? 'white',
            }}
          >
            {data.verdict.replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {/* Execution summary */}
      {data.executionSummary && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Execution Summary</h4>
          <p className="text-sm text-muted-foreground">{data.executionSummary}</p>
        </div>
      )}

      {/* Token cost analysis */}
      {data.tokenCostAnalysis && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Token Cost Analysis</h4>
          <p className="text-sm text-muted-foreground">{data.tokenCostAnalysis}</p>
        </div>
      )}

      {/* Findings */}
      {data.findings && data.findings.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Findings ({data.findings.length})</h4>
          <div className="space-y-2">
            {data.findings.map((finding, i) => (
              <div key={i} className="rounded-md border px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: CATEGORY_COLORS[finding.category] ?? '#6b7280',
                      color: CATEGORY_COLORS[finding.category] ?? '#6b7280',
                    }}
                  >
                    {finding.category.replace(/_/g, ' ')}
                  </Badge>
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: SEVERITY_COLORS[finding.severity] ?? '#6b7280' }}
                  />
                  <span className="text-xs text-muted-foreground">{finding.severity}</span>
                </div>
                <p className="text-sm font-medium">{finding.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{finding.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt improvements */}
      {data.promptImprovements && data.promptImprovements.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Prompt Improvements</h4>
          <ul className="list-disc pl-5 space-y-1">
            {data.promptImprovements.map((item, i) => (
              <li key={i} className="text-sm text-muted-foreground">{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Process improvements */}
      {data.processImprovements && data.processImprovements.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Process Improvements</h4>
          <ul className="list-disc pl-5 space-y-1">
            {data.processImprovements.map((item, i) => (
              <li key={i} className="text-sm text-muted-foreground">{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggested tasks */}
      {data.suggestedTasks && data.suggestedTasks.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">
            Suggested Tasks ({data.suggestedTasks.length})
          </h4>
          <div className="space-y-2">
            {data.suggestedTasks.map((task, i) => (
              <div key={i} className="rounded-md border px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium">{task.title}</p>
                  {task.priority !== undefined && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{
                      backgroundColor: ['#dc2626', '#f59e0b', '#3b82f6', '#6b7280'][task.priority] ?? '#6b7280',
                      color: 'white',
                    }}>
                      P{task.priority}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            These tasks were auto-created in the agent pipeline.
          </p>
        </div>
      )}

      {/* Timestamp */}
      {reviewedAt && (
        <p className="text-xs text-muted-foreground">
          Reviewed at: {new Date(reviewedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
