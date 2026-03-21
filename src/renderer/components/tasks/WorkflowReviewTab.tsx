import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { WorkflowReviewReport } from '../reports/WorkflowReviewReport';
import { reportError } from '../../lib/error-handler';
import type { ReviewData } from '../reports/WorkflowReviewReport';
import type { TaskContextEntry, AgentRun } from '../../../shared/types';

interface WorkflowReviewTabProps {
  taskId: string;
  contextEntries: TaskContextEntry[] | null;
  agentRuns: AgentRun[] | null;
  isFinalStatus: boolean;
  onReviewTriggered: () => void;
}

export function WorkflowReviewTab({
  taskId,
  contextEntries,
  agentRuns,
  isFinalStatus: _isFinalStatus,
  onReviewTriggered,
}: WorkflowReviewTabProps) {
  const navigate = useNavigate();
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
      reportError(err instanceof Error ? err : new Error(String(err)), 'Trigger workflow review');
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
        <div className="flex gap-2">
          {reviewData && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/tasks/${taskId}/workflow-review`)}
            >
              Open Review
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleTriggerReview}
            disabled={isReviewerRunning || triggering}
          >
            {isReviewerRunning ? 'Review in Progress...' : triggering ? 'Starting...' : 'Review Workflow'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isReviewerRunning && !reviewData && (
          <p className="text-sm text-muted-foreground">Workflow review is running. Results will appear here when complete.</p>
        )}

        {!reviewData && !isReviewerRunning && (
          <p className="text-sm text-muted-foreground">
            No workflow review yet. Click &quot;Review Workflow&quot; to analyze the task execution.
          </p>
        )}

        {reviewData && (
          <WorkflowReviewReport
            data={reviewData}
            reviewedAt={reviewEntry?.createdAt}
          />
        )}
      </CardContent>
    </Card>
  );
}
