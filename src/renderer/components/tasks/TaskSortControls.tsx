import React from 'react';
import { Button } from '../ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { SortField, SortDirection } from './task-helpers';

interface TaskSortControlsProps {
  sortField: SortField;
  sortDirection: SortDirection;
  onSortFieldChange: (field: SortField) => void;
  onSortDirectionToggle: () => void;
}

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'title', label: 'Title' },
];

export function TaskSortControls({
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionToggle,
}: TaskSortControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <Select value={sortField} onValueChange={(v) => onSortFieldChange(v as SortField)}>
        <SelectTrigger className="w-28 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onSortDirectionToggle}>
        {sortDirection === 'asc' ? (
          <ArrowUp className="h-4 w-4" />
        ) : (
          <ArrowDown className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
