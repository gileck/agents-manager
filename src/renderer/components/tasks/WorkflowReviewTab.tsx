import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import type { TaskContextEntry, AgentRun } from '../../../shared/types';

interface WorkflowReviewTabProps {
  taskId: string;
  contextEntries: TaskContextEntry[] | null;
  agentRuns: AgentRun[] | null;
  isFinalStatus: boolean;
  onReviewTriggered: () => void;
}

interface ReviewFinding {
  category: string;
  severity: string;
  title: string;
  detail: string;
}

interface ReviewData {
  verdict?: string;
  executionSummary?: string;
  findings?: ReviewFinding[];
  codeImprovements?: string[];
  processImprovements?: string[];
  tokenCostAnalysis?: string;
}

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
  quality: '#3b82f6',
  process: '#06b6d4',
  error_handling: '#f97316',
  cost: '#10b981',
};

export function WorkflowReviewTab({
  taskId,
  contextEntries,
  agentRuns,
  isFinalStatus,
  onReviewTriggered,
}: WorkflowReviewTabProps) {
  const [triggering, setTriggering] = useState(false);

  const reviewEntry = contextEntries?.find(e => e.entryType === 'workflow_review');
  const isReviewerRunning = agentRuns?.some(
    r => r.agentType === 'task-workflow-reviewer' && r.status === 'running'
  ) ?? false;

  const handleTriggerReview = async () => {
    setTriggering(true);
    try {
      await window.api.tasks.workflowReview(taskId);
      onReviewTriggered();
    } catch (err) {
      console.error('Failed to trigger workflow review:', err);
    } finally {
      setTriggering(false);
    }
  };

  const reviewData: ReviewData | null = reviewEntry?.data
    ? (reviewEntry.data as unknown as ReviewData)
    : null;

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Workflow Review</CardTitle>
        <Button
          size="sm"
          onClick={handleTriggerReview}
          disabled={!isFinalStatus || isReviewerRunning || triggering}
        >
          {isReviewerRunning ? 'Review in Progress...' : triggering ? 'Starting...' : 'Review Workflow'}
        </Button>
      </CardHeader>
      <CardContent>
        {isReviewerRunning && !reviewData && (
          <p className="text-sm text-muted-foreground">Workflow review is running. Results will appear here when complete.</p>
        )}

        {!reviewData && !isReviewerRunning && (
          <p className="text-sm text-muted-foreground">
            No workflow review yet. {isFinalStatus ? 'Click "Review Workflow" to analyze the task execution.' : 'Reviews are available after the task reaches a final status.'}
          </p>
        )}

        {reviewData && (
          <div className="space-y-6">
            {/* Verdict badge */}
            {reviewData.verdict && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">Verdict:</span>
                <span
                  className="px-3 py-1 rounded-full text-sm font-semibold"
                  style={{
                    backgroundColor: VERDICT_COLORS[reviewData.verdict]?.bg ?? '#6b7280',
                    color: VERDICT_COLORS[reviewData.verdict]?.text ?? 'white',
                  }}
                >
                  {reviewData.verdict.replace(/_/g, ' ')}
                </span>
              </div>
            )}

            {/* Execution summary */}
            {reviewData.executionSummary && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Execution Summary</h4>
                <p className="text-sm text-muted-foreground">{reviewData.executionSummary}</p>
              </div>
            )}

            {/* Token cost analysis */}
            {reviewData.tokenCostAnalysis && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Token Cost Analysis</h4>
                <p className="text-sm text-muted-foreground">{reviewData.tokenCostAnalysis}</p>
              </div>
            )}

            {/* Findings */}
            {reviewData.findings && reviewData.findings.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Findings ({reviewData.findings.length})</h4>
                <div className="space-y-2">
                  {reviewData.findings.map((finding, i) => (
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

            {/* Code improvements */}
            {reviewData.codeImprovements && reviewData.codeImprovements.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Code Improvements</h4>
                <ul className="list-disc pl-5 space-y-1">
                  {reviewData.codeImprovements.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground">{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Process improvements */}
            {reviewData.processImprovements && reviewData.processImprovements.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Process Improvements</h4>
                <ul className="list-disc pl-5 space-y-1">
                  {reviewData.processImprovements.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground">{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Timestamp */}
            {reviewEntry && (
              <p className="text-xs text-muted-foreground">
                Reviewed at: {new Date(reviewEntry.createdAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
