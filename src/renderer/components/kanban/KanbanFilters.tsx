import React from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Search, X, Filter } from 'lucide-react';
import type { KanbanFilters as KanbanFiltersType } from '../../../shared/types';

interface KanbanFiltersProps {
  filters: KanbanFiltersType;
  onFiltersChange: (filters: KanbanFiltersType) => void;
  availableTags?: string[];
  availableAssignees?: string[];
  onClearFilters?: () => void;
}

export function KanbanFilters({
  filters,
  onFiltersChange,
  availableTags = [],
  availableAssignees = [],
  onClearFilters,
}: KanbanFiltersProps) {
  const hasActiveFilters =
    filters.search ||
    filters.assignee ||
    (filters.tags && filters.tags.length > 0) ||
    filters.featureId;

  const handleSearchChange = (value: string) => {
    onFiltersChange({ ...filters, search: value || undefined });
  };

  const handleAssigneeChange = (value: string) => {
    onFiltersChange({ ...filters, assignee: value === 'all' ? undefined : value });
  };

  const handleTagToggle = (tag: string) => {
    const currentTags = filters.tags || [];
    const newTags = currentTags.includes(tag)
      ? currentTags.filter(t => t !== tag)
      : [...currentTags, tag];
    onFiltersChange({ ...filters, tags: newTags.length > 0 ? newTags : undefined });
  };

  const handleRemoveTag = (tag: string) => {
    const newTags = (filters.tags || []).filter(t => t !== tag);
    onFiltersChange({ ...filters, tags: newTags.length > 0 ? newTags : undefined });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={filters.search || ''}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filters.assignee || 'all'} onValueChange={handleAssigneeChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Assignees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assignees</SelectItem>
            {availableAssignees.map((assignee) => (
              <SelectItem key={assignee} value={assignee}>
                {assignee}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilters && onClearFilters && (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            <X className="w-4 h-4 mr-2" />
            Clear
          </Button>
        )}
      </div>

      {/* Tags Filter */}
      {availableTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Tags:</span>
          {availableTags.map((tag) => {
            const isSelected = filters.tags?.includes(tag);
            return (
              <Badge
                key={tag}
                variant={isSelected ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => handleTagToggle(tag)}
              >
                {tag}
                {isSelected && (
                  <X
                    className="w-3 h-3 ml-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTag(tag);
                    }}
                  />
                )}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Active Filters Summary */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Active filters:</span>
          {filters.search && (
            <Badge variant="secondary">
              Search: "{filters.search}"
            </Badge>
          )}
          {filters.assignee && (
            <Badge variant="secondary">
              Assignee: {filters.assignee}
            </Badge>
          )}
          {filters.tags && filters.tags.length > 0 && (
            <Badge variant="secondary">
              {filters.tags.length} tag{filters.tags.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
