import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { reportError } from '../../lib/error-handler';
import type { Transition, TaskContextEntry } from '../../../shared/types';

interface GenericReviewSectionProps {
  taskId: string;
  /** Title displayed in the card header (e.g. "Plan Review", "Design Review", "Investigation Review") */
  title: string;
  /** The entryType used for feedback context entries (e.g. 'plan_feedback', 'design_feedback', 'investigation_feedback') */
  entryType: string;
  /** The status the task transitions to when approved (e.g. 'implementing') */
  approveToStatus: string;
  /** The status the task transitions to when revisions are requested (e.g. 'planning', 'designing', 'investigating') */
  reviseToStatus: string;
  /** Label for the approve button (default: 'Approve & Implement') */
  approveLabel?: string;
  /** Label for the revise button (default: 'Request Changes') */
  reviseLabel?: string;
  /** Placeholder text for the feedback textarea */
  placeholder?: string;
  entries: TaskContextEntry[];
  transitions: Transition[];
  transitioning: string | null;
  onTransition: (toStatus: string) => Promise<void> | void;
  onRefetch: () => Promise<void> | void;
}

export function GenericReviewSection({
  taskId,
  title,
  entryType,
  approveToStatus,
  reviseToStatus,
  approveLabel = 'Approve & Implement',
  reviseLabel = 'Request Changes',
  placeholder = 'Add feedback...',
  entries,
  transitions,
  transitioning,
  onTransition,
  onRefetch,
}: GenericReviewSectionProps) {
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);

  const approveTransition = transitions.find((t) => t.to === approveToStatus);
  const reviseTransition = transitions.find((t) => t.to === reviseToStatus);

  const handleAction = async (toStatus: string) => {
    setSaving(true);
    try {
      if (newComment.trim()) {
        await window.api.tasks.addFeedback(taskId, {
          entryType,
          content: newComment.trim(),
        });
        setNewComment('');
        await onRefetch();
      }
      await onTransition(toStatus);
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), `${title} action`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-4 border-blue-400">
      <CardHeader className="py-3">
        <CardTitle className="text-base">{title}</CardTitle>
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
          placeholder={placeholder}
          rows={3}
          className="mb-3"
        />

        <div className="flex gap-2">
          {approveTransition && (
            <Button
              onClick={() => handleAction(approveTransition.to)}
              disabled={saving || transitioning !== null}
            >
              {transitioning === approveTransition.to ? 'Approving...' : approveTransition.label || approveLabel}
            </Button>
          )}
          {reviseTransition && (
            <Button
              variant="outline"
              onClick={() => handleAction(reviseTransition.to)}
              disabled={saving || transitioning !== null || !newComment.trim()}
            >
              {transitioning === reviseTransition.to ? 'Requesting...' : reviseTransition.label || reviseLabel}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
