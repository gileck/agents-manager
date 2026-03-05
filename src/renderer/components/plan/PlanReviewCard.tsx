import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { FullscreenReviewOverlay } from './FullscreenReviewOverlay';
import type { TaskContextEntry, Transition } from '../../../shared/types';

interface PlanReviewCardProps {
  title: string;
  content: string | null;
  emptyContentMessage: string;
  entries: TaskContextEntry[];
  isReviewStatus: boolean;
  transitions: Transition[];
  transitioning: string | null;
  approveToStatus?: string;
  reviseToStatus?: string;
  onAction: (toStatus: string, comment: string) => Promise<void>;
  renderContent?: (content: string) => React.ReactNode;
  taskId?: string;
  agentRole?: string;
  entryType?: string;
  onEntriesChanged?: () => void;
}

export function PlanReviewCard({
  title,
  content,
  emptyContentMessage,
  entries,
  isReviewStatus,
  transitions,
  transitioning,
  approveToStatus = 'implementing',
  reviseToStatus,
  onAction,
  renderContent,
  taskId,
  agentRole,
  entryType = 'plan_feedback',
  onEntriesChanged,
}: PlanReviewCardProps) {
  const [overlayOpen, setOverlayOpen] = useState(false);

  const approveTransition = transitions.find((t) => t.to === approveToStatus);

  const defaultRenderContent = (c: string) => <pre className="whitespace-pre-wrap text-sm">{c}</pre>;
  const contentRenderer = renderContent || defaultRenderContent;

  return (
    <>
      <Card className={`mt-4 ${isReviewStatus ? 'border-blue-400' : ''}`}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{title}</CardTitle>
            {content && (
              <Button variant="outline" size="sm" onClick={() => setOverlayOpen(true)}>
                Open Review
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Content Section */}
          <div className="mb-4">
            {content ? (
              contentRenderer(content)
            ) : (
              <p className="text-sm text-muted-foreground">{emptyContentMessage}</p>
            )}
          </div>

          {/* Quick approve button during review */}
          {isReviewStatus && content && approveTransition && (
            <div className="flex gap-2 pt-4 border-t">
              <Button
                onClick={() => onAction(approveTransition.to, '')}
                disabled={transitioning !== null}
              >
                {transitioning === approveTransition.to ? 'Approving...' : approveTransition.label || 'Approve & Implement'}
              </Button>
            </div>
          )}

          {/* Show entry count as hint */}
          {entries.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              {entries.length} review comment{entries.length !== 1 ? 's' : ''} —{' '}
              <button
                className="underline hover:text-foreground"
                onClick={() => setOverlayOpen(true)}
              >
                view conversation
              </button>
            </p>
          )}
        </CardContent>
      </Card>

      <FullscreenReviewOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        title={title}
        content={content}
        renderContent={contentRenderer}
        entries={entries}
        isReviewStatus={isReviewStatus}
        transitions={transitions}
        transitioning={transitioning}
        approveToStatus={approveToStatus}
        reviseToStatus={reviseToStatus}
        onAction={onAction}
        taskId={taskId}
        agentRole={agentRole}
        entryType={entryType}
        onEntriesChanged={onEntriesChanged || (() => {})}
      />
    </>
  );
}
