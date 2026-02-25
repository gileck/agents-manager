import React from 'react';
import type { PlanComment } from '../../../shared/types';

interface CommentThreadProps {
  comments: PlanComment[];
  emptyMessage?: string;
}

export function CommentThread({ comments, emptyMessage = 'No comments yet.' }: CommentThreadProps) {
  if (!comments || comments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <div className="space-y-2">
      {comments.map((comment, i) => (
        <div key={i} className="rounded-md bg-muted px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold">{comment.author}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(comment.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
        </div>
      ))}
    </div>
  );
}