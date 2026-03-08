import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import { Search, SlidersHorizontal, ArrowUp, ArrowDown, List, LayoutGrid, Plus, X } from 'lucide-react';
import { countActiveFilters, PRIORITY_LABELS } from './task-helpers';
import type { FilterState } from './TaskFilterBar';
import type { SortField, SortDirection, GroupBy, ViewMode } from './task-helpers';
import type { Pipeline, Feature } from '../../../shared/types';

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'title', label: 'Title' },
];

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'feature', label: 'Feature' },
  { value: 'createdBy', label: 'Created By' },
];

function useDebouncedCallback(callback: (value: string) => void, delay: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timerRef.current); }, []);
  return (value: string) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => callback(value), delay);
  };
}

interface TaskToolbarProps {
  filters: FilterState;
  onFiltersChange: (f: FilterState) => void;
  filterPanelOpen: boolean;
  onFilterPanelToggle: () => void;
  groupBy: GroupBy;
  onGroupByChange: (g: GroupBy) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortFieldChange: (f: SortField) => void;
  onSortDirectionToggle: () => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  onNewTask: () => void;
  pipelines: Pipeline[];
  features?: Feature[];
  statusSummary?: React.ReactNode;
}

export function TaskToolbar({
  filters,
  onFiltersChange,
  filterPanelOpen,
  onFilterPanelToggle,
  groupBy,
  onGroupByChange,
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionToggle,
  viewMode,
  onViewModeChange,
  onNewTask,
  pipelines,
  features,
  statusSummary,
}: TaskToolbarProps) {
  const [localSearch, setLocalSearch] = useState(filters.search);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const debouncedSearch = useDebouncedCallback(
    (value) => onFiltersChange({ ...filtersRef.current, search: value }),
    300,
  );

  useEffect(() => { setLocalSearch(filters.search); }, [filters.search]);

  // Count only panel-resident filters (not search, which is always visible inline)
  const activeCount = countActiveFilters({ ...filters, search: '' });

  // Active filter chips for panel-resident filters only (search is visible inline, not duplicated here)
  const activeChips: { key: keyof FilterState; label: string }[] = [];
  if (filters.status) activeChips.push({ key: 'status', label: `status: ${filters.status}` });
  if (filters.priority) {
    const priorityLabel = PRIORITY_LABELS[Number(filters.priority)] ?? `P${filters.priority}`;
    activeChips.push({ key: 'priority', label: `priority: ${priorityLabel}` });
  }
  if (filters.pipelineId) {
    const pName = pipelines.find((p) => p.id === filters.pipelineId)?.name ?? filters.pipelineId;
    activeChips.push({ key: 'pipelineId', label: `pipeline: ${pName}` });
  }
  if (filters.assignee) activeChips.push({ key: 'assignee', label: `assignee: ${filters.assignee}` });
  if (filters.tag) activeChips.push({ key: 'tag', label: `tag: ${filters.tag}` });
  if (filters.featureId) {
    const fLabel = filters.featureId === '__none__'
      ? 'No feature'
      : (features?.find((f) => f.id === filters.featureId)?.title ?? filters.featureId);
    activeChips.push({ key: 'featureId', label: `feature: ${fLabel}` });
  }
  if (filters.createdBy) activeChips.push({ key: 'createdBy', label: `by: ${filters.createdBy}` });

  return (
    <div className="space-y-2">
      {/* Single-row toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="w-48 pl-8 h-8 text-sm"
            value={localSearch}
            onChange={(e) => {
              setLocalSearch(e.target.value);
              debouncedSearch(e.target.value);
            }}
            placeholder="Search tasks..."
          />
        </div>

        {/* Filters toggle */}
        <Button
          variant={filterPanelOpen ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 gap-1.5"
          onClick={onFilterPanelToggle}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeCount > 0 && (
            <Badge className="h-4 px-1.5 text-[10px] ml-0.5 bg-primary text-primary-foreground">
              {activeCount}
            </Badge>
          )}
        </Button>

        <div className="h-5 w-px bg-border" />

        {/* Group selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Group:</span>
          <Select value={groupBy} onValueChange={(v) => onGroupByChange(v as GroupBy)}>
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Sort selector + direction */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Sort:</span>
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
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <div className="h-5 w-px bg-border" />

        {/* View mode toggle */}
        <div className="flex items-center rounded-md border overflow-hidden">
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8 rounded-none border-0"
            onClick={() => onViewModeChange('list')}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewMode === 'card' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8 rounded-none border-0"
            onClick={() => onViewModeChange('card')}
            title="Card view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Spacer to push right-side items to the end */}
        <div className="flex-1" />

        {/* Status summary — right gutter */}
        {statusSummary && (
          <div className="text-xs text-muted-foreground">
            {statusSummary}
          </div>
        )}

        {/* New Task button — always rightmost */}
        <Button size="sm" className="h-8 gap-1.5" onClick={onNewTask}>
          <Plus className="h-3.5 w-3.5" />
          New Task
        </Button>
      </div>

      {/* Active filter chips row */}
      {activeChips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {activeChips.map((chip) => (
            <Badge
              key={chip.key}
              variant="secondary"
              className="cursor-pointer gap-1 pr-1 text-xs"
              onClick={() => {
                onFiltersChange({ ...filters, [chip.key]: '' });
                if (chip.key === 'search') setLocalSearch('');
              }}
            >
              {chip.label}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            onClick={() => {
              onFiltersChange({
                search: '', status: '', priority: '', pipelineId: '',
                assignee: '', tag: '', featureId: '', createdBy: '',
              });
              setLocalSearch('');
            }}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
