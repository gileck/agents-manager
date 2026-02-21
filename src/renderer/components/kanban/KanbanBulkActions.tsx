import React from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
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
      <div className="bg-card border rounded-lg shadow-lg p-3 flex items-center gap-3">
        <Badge variant="secondary" className="font-medium">
          {selectedCount} selected
        </Badge>

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
