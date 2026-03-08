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

/**
 * Fixed floating bar at the bottom-center of the viewport.
 * Renders only when items are selected (selectedCount > 0).
 */
export function TaskBulkActionBar({
  selectedCount,
  totalCount,
  allSelected,
  someSelected,
  onSelectAll,
  onDeleteSelected,
  onExit,
}: TaskBulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full border bg-background shadow-lg shadow-black/10">
      {/* Select-all checkbox */}
      <input
        type="checkbox"
        checked={allSelected}
        ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
        onChange={onSelectAll}
        className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
        title={allSelected ? 'Deselect all' : 'Select all'}
      />

      {/* Selected count */}
      <span className="text-sm font-medium whitespace-nowrap">
        {selectedCount} of {totalCount} selected
      </span>

      {/* Delete button */}
      <Button
        variant="destructive"
        size="sm"
        className="h-7 gap-1.5 rounded-full"
        onClick={onDeleteSelected}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete ({selectedCount})
      </Button>

      {/* Exit selection */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-muted-foreground hover:text-foreground"
        onClick={onExit}
      >
        <X className="h-3.5 w-3.5" />
        Exit
      </Button>
    </div>
  );
}
