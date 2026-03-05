import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { MarkdownContent } from '../chat/MarkdownContent';
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
  onAction: (toStatus: string, comment: string) => Promise<void>;
  renderContent?: (content: string) => React.ReactNode;
  reviewPath?: string;
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
  onAction,
  renderContent,
  reviewPath,
}: PlanReviewCardProps) {
  const navigate = useNavigate();
  const approveTransition = transitions.find((t) => t.to === approveToStatus);

  const defaultRenderContent = (c: string) => <pre className="whitespace-pre-wrap text-sm">{c}</pre>;
  const contentRenderer = renderContent || defaultRenderContent;

  return (
    <Card className={`mt-4 ${isReviewStatus ? 'border-blue-400' : ''}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
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

        {/* Inline review comments */}
        {entries.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-muted-foreground">
                Review Comments ({entries.length})
              </h4>
              {reviewPath && (
                <Button variant="outline" size="sm" onClick={() => navigate(reviewPath)}>
                  Open Review
                </Button>
              )}
            </div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {entries.map((entry) => {
                const isUser = entry.source === 'admin' || entry.source === 'user';
                return (
                  <div key={entry.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`rounded-lg px-3 py-2 max-w-[85%] text-sm ${
                        isUser
                          ? 'bg-primary/10 text-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      {!isUser && (
                        <span className="text-xs font-semibold text-muted-foreground">{entry.source}</span>
                      )}
                      <div className="prose-sm max-w-none">
                        <MarkdownContent content={entry.summary} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(entry.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
