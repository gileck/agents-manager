import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { CommentThread } from '../plan/CommentThread';
import type { TaskContextEntry } from '../../../shared/types';
import { reportError } from '../../lib/error-handler';

interface TaskCommentsCardProps {
  taskId: string;
  contextEntries: TaskContextEntry[];
  onCommentAdded: () => void;
}

export function TaskCommentsCard({ taskId, contextEntries, onCommentAdded }: TaskCommentsCardProps) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const comments = contextEntries
    .filter((e) => e.entryType === 'comment')
    .sort((a, b) => a.createdAt - b.createdAt);

  const handleSubmit = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      await window.api.tasks.addContextEntry(taskId, {
        source: 'user',
        entryType: 'comment',
        summary: text,
      });
      setDraft('');
      onCommentAdded();
    } catch (err) {
      reportError(err, 'TaskCommentsCard: add comment');
    } finally {
      setSubmitting(false);
    }
  }, [taskId, draft, onCommentAdded]);

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Comments</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <CommentThread entries={comments} emptyMessage="No comments yet." />
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Add a comment..."
            rows={3}
            style={{
              width: '100%', resize: 'vertical', fontSize: 13,
              padding: 8, borderRadius: 6, border: '1px solid var(--border)',
              backgroundColor: 'var(--background)', color: 'var(--foreground)',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || !draft.trim()}
            >
              {submitting ? 'Adding...' : 'Add Comment'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
