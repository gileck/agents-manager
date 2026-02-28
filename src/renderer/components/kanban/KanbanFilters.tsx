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
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Search, X, Filter } from 'lucide-react';
import { getTagColor } from '../../utils/kanban-colors';
import type { KanbanFilters as KanbanFiltersType } from '../../../shared/types';

interface KanbanFiltersProps {
  filters: KanbanFiltersType;
  onFiltersChange: (filters: KanbanFiltersType) => void;
  availableTags?: string[];
  availableAssignees?: string[];
  onClearFilters?: () => void;
  hideEmptyColumns?: boolean;
  onHideEmptyColumnsChange?: (value: boolean) => void;
}

export function KanbanFilters({
  filters,
  onFiltersChange,
  availableTags = [],
  availableAssignees = [],
  onClearFilters,
  hideEmptyColumns = false,
  onHideEmptyColumnsChange,
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
        <div style={{ width: '180px' }}>
          <Select value={filters.assignee || 'all'} onValueChange={handleAssigneeChange}>
            <SelectTrigger>
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
        </div>
        {hasActiveFilters && onClearFilters && (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            <X className="w-4 h-4 mr-2" />
            Clear
          </Button>
        )}
        {onHideEmptyColumnsChange && (
          <div className="flex items-center gap-1.5 ml-2">
            <Switch
              id="hide-empty"
              checked={hideEmptyColumns}
              onCheckedChange={onHideEmptyColumnsChange}
            />
            <Label htmlFor="hide-empty" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
              Hide empty
            </Label>
          </div>
        )}
      </div>

      {/* Tags Filter */}
      {availableTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Tags:</span>
          {availableTags.map((tag) => {
            const isSelected = filters.tags?.includes(tag);
            const tagColor = getTagColor(tag);
            return isSelected ? (
              <span
                key={tag}
                className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border cursor-pointer transition-all"
                style={tagColor.style}
                onClick={() => handleTagToggle(tag)}
              >
                {tag}
                <X
                  className="w-3 h-3 ml-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveTag(tag);
                  }}
                />
              </span>
            ) : (
              <Badge
                key={tag}
                variant="outline"
                className="cursor-pointer hover:bg-accent transition-colors"
                onClick={() => handleTagToggle(tag)}
              >
                {tag}
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
              Search: &quot;{filters.search}&quot;
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
