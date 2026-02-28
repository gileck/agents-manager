import React from 'react';
import { Button } from '../ui/button';
import { X, Trash2, Tag, User } from 'lucide-react';

interface KanbanBulkActionsProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkDelete?: () => void;
  onBulkTag?: () => void;
  onBulkAssign?: () => void;
}

export function KanbanBulkActions({
  selectedCount,
  onClearSelection,
  onBulkDelete,
  onBulkTag,
  onBulkAssign,
}: KanbanBulkActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div
        className="border rounded-xl shadow-2xl p-3 flex items-center gap-3"
        style={{ backgroundColor: 'hsl(var(--card))', backdropFilter: 'blur(12px)' }}
      >
        <span
          className="inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border"
          style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3b82f6', borderColor: 'rgba(59, 130, 246, 0.3)' }}
        >
          {selectedCount} selected
        </span>

        <div className="flex items-center gap-2">
          {onBulkTag && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkTag}
              title="Add tags to selected tasks"
            >
              <Tag className="w-4 h-4 mr-2" />
              Tag
            </Button>
          )}

          {onBulkAssign && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkAssign}
              title="Assign selected tasks"
            >
              <User className="w-4 h-4 mr-2" />
              Assign
            </Button>
          )}

          {onBulkDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkDelete}
              title="Delete selected tasks"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          )}

          <div className="w-px h-6 bg-border" />

          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
