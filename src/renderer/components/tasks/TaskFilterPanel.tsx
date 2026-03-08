import React, { useState, useEffect, useRef } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import { PRIORITY_LABELS } from './task-helpers';
import type { FilterState } from './TaskFilterBar';
import type { Pipeline, Feature } from '../../../shared/types';

function useDebouncedCallback(callback: (value: string) => void, delay: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timerRef.current); }, []);
  return (value: string) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => callback(value), delay);
  };
}

interface TaskFilterPanelProps {
  open: boolean;
  filters: FilterState;
  onFiltersChange: (f: FilterState) => void;
  statuses: string[];
  pipelines: Pipeline[];
  tags: string[];
  features?: Feature[];
}

export function TaskFilterPanel({
  open,
  filters,
  onFiltersChange,
  statuses,
  pipelines,
  tags,
  features,
}: TaskFilterPanelProps) {
  const [localAssignee, setLocalAssignee] = useState(filters.assignee);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const debouncedAssignee = useDebouncedCallback(
    (value) => onFiltersChange({ ...filtersRef.current, assignee: value }),
    300,
  );

  useEffect(() => { setLocalAssignee(filters.assignee); }, [filters.assignee]);

  const update = (patch: Partial<FilterState>) => onFiltersChange({ ...filters, ...patch });

  const clearAll = () => {
    onFiltersChange({
      search: '', status: '', priority: '', pipelineId: '',
      assignee: '', tag: '', featureId: '', createdBy: '',
    });
    setLocalAssignee('');
  };

  return (
    <div
      className="overflow-hidden transition-all duration-300 ease-in-out"
      style={{ maxHeight: open ? '300px' : '0px', opacity: open ? 1 : 0 }}
    >
      <div className="border rounded-lg bg-muted/30 p-4 mt-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Status */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <Select value={filters.status} onValueChange={(v) => update({ status: v === '__all__' ? '' : v })}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Priority</label>
            <Select value={filters.priority} onValueChange={(v) => update({ priority: v === '__all__' ? '' : v })}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All priorities</SelectItem>
                {Object.entries(PRIORITY_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Pipeline */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Pipeline</label>
            <Select value={filters.pipelineId} onValueChange={(v) => update({ pipelineId: v === '__all__' ? '' : v })}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All pipelines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All pipelines</SelectItem>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Assignee */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Assignee</label>
            <Input
              className="h-8 text-sm"
              value={localAssignee}
              onChange={(e) => {
                setLocalAssignee(e.target.value);
                debouncedAssignee(e.target.value);
              }}
              placeholder="Filter by assignee..."
            />
          </div>

          {/* Tag */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Tag</label>
            <Select value={filters.tag} onValueChange={(v) => update({ tag: v === '__all__' ? '' : v })}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All tags" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All tags</SelectItem>
                {tags.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Feature */}
          {features && features.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Feature</label>
              <Select value={filters.featureId} onValueChange={(v) => update({ featureId: v === '__all__' ? '' : v })}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="All features" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All features</SelectItem>
                  <SelectItem value="__none__">No feature</SelectItem>
                  {features.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Created By */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Created By</label>
            <Select value={filters.createdBy} onValueChange={(v) => update({ createdBy: v === '__all__' ? '' : v })}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All creators" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All creators</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="workflow-reviewer">Workflow</SelectItem>
                <SelectItem value="session-agent">Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={clearAll}
          >
            Clear all filters
          </Button>
        </div>
      </div>
    </div>
  );
}
