import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Trash2, X, ChevronDown, Pencil, Loader2 } from 'lucide-react';
import type { Pipeline, Feature, Task } from '../../../shared/types';

interface TaskBulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: () => void;
  onDeleteSelected: () => void;
  onExit: () => void;
  // new
  pipelines: Pipeline[];
  tasks: Task[];
  features: Feature[];
  onBatchPriority: (priority: number) => void;
  onBatchStatus: (toStatus: string) => void;
  onBatchEdit: () => void;
  batchUpdating?: boolean;
}

const PRIORITY_OPTIONS = [
  { value: 0, label: 'Critical (P0)' },
  { value: 1, label: 'High (P1)' },
  { value: 2, label: 'Medium (P2)' },
  { value: 3, label: 'Low (P3)' },
];

function InlineDropdown({
  label,
  items,
  onSelect,
  disabled,
  warning,
}: {
  label: string;
  items: { value: string; label: string }[];
  onSelect: (value: string) => void;
  disabled?: boolean;
  warning?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-sm rounded-full"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        {label}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </Button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 min-w-[160px] rounded-md border bg-popover shadow-md py-1">
          {warning && (
            <p className="px-3 py-1 text-xs text-amber-600">{warning}</p>
          )}
          {items.map((item) => (
            <button
              key={item.value}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => {
                onSelect(item.value);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  pipelines,
  onBatchPriority,
  onBatchStatus,
  onBatchEdit,
  batchUpdating,
}: TaskBulkActionBarProps) {
  if (selectedCount === 0) return null;

  const allStatuses = pipelines
    .flatMap((p) => p.statuses)
    .reduce<{ value: string; label: string }[]>((acc, s) => {
      if (!acc.find((x) => x.value === s.name)) {
        acc.push({ value: s.name, label: s.label || s.name });
      }
      return acc;
    }, []);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full border bg-background shadow-lg shadow-black/10">
      {/* Select-all checkbox */}
      <input
        type="checkbox"
        checked={allSelected}
        ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
        onChange={onSelectAll}
        className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
        title={allSelected ? 'Deselect all' : 'Select all'}
        disabled={batchUpdating}
      />

      {/* Selected count */}
      <span className="text-sm font-medium whitespace-nowrap">
        {selectedCount} of {totalCount}
      </span>

      {batchUpdating && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}

      {/* Priority dropdown */}
      <InlineDropdown
        label="Priority"
        items={PRIORITY_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
        onSelect={(v) => onBatchPriority(Number(v))}
        disabled={batchUpdating}
      />

      {/* Status dropdown */}
      {allStatuses.length > 0 && (
        <InlineDropdown
          label="Status"
          items={allStatuses}
          onSelect={onBatchStatus}
          disabled={batchUpdating}
          warning="Guards bypassed for batch"
        />
      )}

      {/* Edit fields */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 rounded-full"
        onClick={onBatchEdit}
        disabled={batchUpdating}
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit fields
      </Button>

      {/* Delete button */}
      <Button
        variant="destructive"
        size="sm"
        className="h-7 gap-1.5 rounded-full"
        onClick={onDeleteSelected}
        disabled={batchUpdating}
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
        disabled={batchUpdating}
      >
        <X className="h-3.5 w-3.5" />
        Exit
      </Button>
    </div>
  );
}
