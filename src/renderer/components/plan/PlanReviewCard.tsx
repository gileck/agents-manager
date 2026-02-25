import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { CommentThread } from './CommentThread';
import { CommentInput } from './CommentInput';
import type { PlanComment, Transition } from '../../../shared/types';

interface PlanReviewCardProps {
  title: string;
  content: string | null;
  emptyContentMessage: string;
  comments: PlanComment[];
  isReviewStatus: boolean;
  transitions: Transition[];
  transitioning: string | null;
  commentPlaceholder: string;
  approveToStatus?: string;
  reviseToStatus?: string;
  onAction: (toStatus: string, comment: string) => Promise<void>;
  renderContent?: (content: string) => React.ReactNode;
}

export function PlanReviewCard({
  title,
  content,
  emptyContentMessage,
  comments,
  isReviewStatus,
  transitions,
  transitioning,
  commentPlaceholder,
  approveToStatus = 'implementing',
  reviseToStatus,
  onAction,
  renderContent,
}: PlanReviewCardProps) {
  const approveTransition = transitions.find((t) => t.to === approveToStatus);
  const reviseTransition = reviseToStatus ? transitions.find((t) => t.to === reviseToStatus) : undefined;

  return (
    <Card className={`mt-4 ${isReviewStatus ? 'border-blue-400' : ''}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Content Section */}
        <div className="mb-6">
          {content ? (
            renderContent ? renderContent(content) : <pre className="whitespace-pre-wrap text-sm">{content}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">{emptyContentMessage}</p>
          )}
        </div>

        {/* Comments Section - Always visible */}
        {(comments.length > 0 || isReviewStatus) && (
          <div className="border-t pt-4 mt-6">
            <h4 className="text-sm font-semibold mb-3 text-muted-foreground">Review Comments</h4>

            {/* Comment History */}
            {comments.length > 0 && (
              <div className="mb-4">
                <CommentThread
                  comments={comments}
                  emptyMessage="No review comments yet."
                />
              </div>
            )}

            {/* Comment Input - Only during review */}
            {isReviewStatus && (
              <CommentInput
                placeholder={commentPlaceholder}
                approveTransition={approveTransition}
                reviseTransition={reviseTransition}
                transitioning={transitioning}
                onAction={onAction}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}