import React, { useState, useEffect } from 'react';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import { Search, X } from 'lucide-react';
import { PRIORITY_LABELS, countActiveFilters } from './task-helpers';
import type { Pipeline, Feature } from '../../../shared/types';

export interface FilterState {
  search: string;
  status: string;
  priority: string;
  pipelineId: string;
  assignee: string;
  tag: string;
  featureId: string;
  domain: string;
}

export const EMPTY_FILTERS: FilterState = {
  search: '',
  status: '',
  priority: '',
  pipelineId: '',
  assignee: '',
  tag: '',
  featureId: '',
  domain: '',
};

interface TaskFilterBarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  statuses: string[];
  pipelines: Pipeline[];
  tags: string[];
  features?: Feature[];
  domains?: string[];
}

function useDebouncedCallback(callback: (value: string) => void, delay: number) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timerRef.current); }, []);
  return (value: string) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => callback(value), delay);
  };
}

export function TaskFilterBar({ filters, onFiltersChange, statuses, pipelines, tags, features, domains }: TaskFilterBarProps) {
  const [localSearch, setLocalSearch] = useState(filters.search);
  const [localAssignee, setLocalAssignee] = useState(filters.assignee);

  // Use a ref to avoid stale closures in debounced callbacks
  const filtersRef = React.useRef(filters);
  filtersRef.current = filters;

  const debouncedSearch = useDebouncedCallback(
    (value) => onFiltersChange({ ...filtersRef.current, search: value }),
    300,
  );
  const debouncedAssignee = useDebouncedCallback(
    (value) => onFiltersChange({ ...filtersRef.current, assignee: value }),
    300,
  );

  // Sync local state if parent resets filters
  useEffect(() => { setLocalSearch(filters.search); }, [filters.search]);
  useEffect(() => { setLocalAssignee(filters.assignee); }, [filters.assignee]);

  const update = (patch: Partial<FilterState>) => onFiltersChange({ ...filters, ...patch });
  const activeCount = countActiveFilters(filters);

  const activeChips: { key: keyof FilterState; label: string }[] = [];
  if (filters.search) activeChips.push({ key: 'search', label: `search: ${filters.search}` });
  if (filters.status) activeChips.push({ key: 'status', label: `status: ${filters.status}` });
  if (filters.priority) activeChips.push({ key: 'priority', label: `priority: P${filters.priority}` });
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
  if (filters.domain) activeChips.push({ key: 'domain', label: `domain: ${filters.domain}` });

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            value={localSearch}
            onChange={(e) => {
              setLocalSearch(e.target.value);
              debouncedSearch(e.target.value);
            }}
            placeholder="Search..."
          />
        </div>
        <Select value={filters.status} onValueChange={(v) => update({ status: v === '__all__' ? '' : v })}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.priority} onValueChange={(v) => update({ priority: v === '__all__' ? '' : v })}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All priorities</SelectItem>
            {Object.entries(PRIORITY_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.pipelineId} onValueChange={(v) => update({ pipelineId: v === '__all__' ? '' : v })}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Pipeline" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All pipelines</SelectItem>
            {pipelines.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Input
            className="w-32"
            value={localAssignee}
            onChange={(e) => {
              setLocalAssignee(e.target.value);
              debouncedAssignee(e.target.value);
            }}
            placeholder="Assignee..."
          />
        </div>
        {tags.length > 0 && (
          <Select value={filters.tag} onValueChange={(v) => update({ tag: v === '__all__' ? '' : v })}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All tags</SelectItem>
              {tags.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {features && features.length > 0 && (
          <Select value={filters.featureId} onValueChange={(v) => update({ featureId: v === '__all__' ? '' : v })}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Feature" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All features</SelectItem>
              <SelectItem value="__none__">No feature</SelectItem>
              {features.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {domains && domains.length > 0 && (
          <Select value={filters.domain} onValueChange={(v) => update({ domain: v === '__all__' ? '' : v })}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Domain" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All domains</SelectItem>
              {domains.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onFiltersChange(EMPTY_FILTERS);
              setLocalSearch('');
              setLocalAssignee('');
            }}
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>
      {activeChips.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {activeChips.map((chip) => (
            <Badge
              key={chip.key}
              variant="secondary"
              className="cursor-pointer gap-1"
              onClick={() => {
                update({ [chip.key]: '' });
                if (chip.key === 'search') setLocalSearch('');
                if (chip.key === 'assignee') setLocalAssignee('');
              }}
            >
              {chip.label}
              <X className="h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
