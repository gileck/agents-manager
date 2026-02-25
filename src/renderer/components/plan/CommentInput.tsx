import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import type { Transition } from '../../../shared/types';

interface CommentInputProps {
  placeholder: string;
  approveTransition?: Transition;
  reviseTransition?: Transition;
  transitioning: string | null;
  onAction: (toStatus: string, comment: string) => Promise<void>;
}

export function CommentInput({
  placeholder,
  approveTransition,
  reviseTransition,
  transitioning,
  onAction,
}: CommentInputProps) {
  const [newComment, setNewComment] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAction = async (toStatus: string) => {
    setSaving(true);
    try {
      await onAction(toStatus, newComment);
      setNewComment('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
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
            {transitioning === approveTransition.to ? 'Approving...' : approveTransition.label || 'Approve & Implement'}
          </Button>
        )}
        {reviseTransition && (
          <Button
            variant="outline"
            onClick={() => handleAction(reviseTransition.to)}
            disabled={saving || transitioning !== null || !newComment.trim()}
          >
            {transitioning === reviseTransition.to ? 'Requesting...' : reviseTransition.label || 'Request Changes'}
          </Button>
        )}
      </div>
    </>
  );
}