import React from 'react';
import { Button } from '../ui/button';
import { Trash2, X } from 'lucide-react';

interface TaskBulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: () => void;
  onDeleteSelected: () => void;
  onExit: () => void;
}

export function TaskBulkActionBar({
  selectedCount,
  totalCount,
  allSelected,
  someSelected,
  onSelectAll,
  onDeleteSelected,
  onExit,
}: TaskBulkActionBarProps) {
  if (selectedCount === 0 && !allSelected && !someSelected) {
    return (
      <div className="flex items-center gap-3 px-4 py-2 mb-2 rounded-lg border bg-muted/40">
        <input
          type="checkbox"
          checked={false}
          onChange={onSelectAll}
          className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
        />
        <span className="text-sm text-muted-foreground">Select all</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1" onClick={onExit}>
          <X className="h-3.5 w-3.5" />
          Exit selection
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 mb-2 rounded-lg border bg-muted/40">
      <input
        type="checkbox"
        checked={allSelected}
        ref={(el) => { if (el) el.indeterminate = someSelected; }}
        onChange={onSelectAll}
        className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
      />
      <span className="text-sm text-muted-foreground">
        {selectedCount > 0
          ? `${selectedCount} of ${totalCount} selected`
          : 'Select all'}
      </span>
      {selectedCount > 0 && (
        <Button
          variant="destructive"
          size="sm"
          className="h-7 gap-1.5"
          onClick={onDeleteSelected}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete selected ({selectedCount})
        </Button>
      )}
      <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1" onClick={onExit}>
        <X className="h-3.5 w-3.5" />
        Exit selection
      </Button>
    </div>
  );
}
