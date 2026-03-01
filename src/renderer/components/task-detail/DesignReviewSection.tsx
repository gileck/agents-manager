import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import type { Transition, TaskContextEntry } from '../../../shared/types';

interface DesignReviewSectionProps {
  taskId: string;
  entries: TaskContextEntry[];
  transitions: Transition[];
  transitioning: string | null;
  onTransition: (toStatus: string) => Promise<void> | void;
  onRefetch: () => Promise<void> | void;
}

export function DesignReviewSection({
  taskId,
  entries,
  transitions,
  transitioning,
  onTransition,
  onRefetch,
}: DesignReviewSectionProps) {
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);

  const approveTransition = transitions.find((t) => t.to === 'implementing');
  const reviseTransition = transitions.find((t) => t.to === 'designing');

  const handleAction = async (toStatus: string) => {
    setSaving(true);
    try {
      if (newComment.trim()) {
        await window.api.tasks.addFeedback(taskId, {
          entryType: 'design_feedback',
          content: newComment.trim(),
        });
        setNewComment('');
        await onRefetch();
      }
      await onTransition(toStatus);
    } catch (err) {
      console.error('Design review action failed', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-4 border-blue-400">
      <CardHeader className="py-3">
        <CardTitle className="text-base">Design Review</CardTitle>
      </CardHeader>
      <CardContent>
        {entries && entries.length > 0 && (
          <div className="space-y-2 mb-4">
            {entries.map((entry) => (
              <div key={entry.id} className={`rounded-md bg-muted px-3 py-2${entry.addressed ? ' opacity-50' : ''}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold">{entry.source}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  {entry.addressed && (
                    <span className="text-xs bg-muted-foreground/20 text-muted-foreground px-1.5 py-0.5 rounded">
                      Addressed
                    </span>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{entry.summary}</p>
              </div>
            ))}
          </div>
        )}

        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add feedback for the design agent..."
          rows={3}
          className="mb-3"
        />

        <div className="flex gap-2">
          {approveTransition && (
            <Button
              onClick={() => handleAction(approveTransition.to)}
              disabled={saving || transitioning !== null}
            >
              {transitioning === approveTransition.to ? 'Approving...' : 'Approve & Implement'}
            </Button>
          )}
          {reviseTransition && (
            <Button
              variant="outline"
              onClick={() => handleAction(reviseTransition.to)}
              disabled={saving || transitioning !== null || !newComment.trim()}
            >
              {transitioning === reviseTransition.to ? 'Requesting...' : 'Request Design Changes'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
