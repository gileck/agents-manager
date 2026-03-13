import React, { useState, useMemo } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { ScrollArea } from '../ui/scroll-area';
import { Search, X, Tag, Check } from 'lucide-react';
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
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');

  const hasActiveFilters =
    filters.search ||
    filters.assignee ||
    (filters.tags && filters.tags.length > 0) ||
    filters.featureId;

  const selectedTagCount = filters.tags?.length ?? 0;

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

  const filteredTags = useMemo(() => {
    if (!tagSearch) return availableTags;
    const lower = tagSearch.toLowerCase();
    return availableTags.filter(t => t.toLowerCase().includes(lower));
  }, [availableTags, tagSearch]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative" style={{ width: '220px' }}>
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search tasks..."
          value={filters.search || ''}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* Assignee */}
      <div style={{ width: '160px' }}>
        <Select value={filters.assignee || 'all'} onValueChange={handleAssigneeChange}>
          <SelectTrigger className="h-8 text-sm">
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

      {/* Tags Popover */}
      {availableTags.length > 0 && (
        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm">
              <Tag className="w-3.5 h-3.5" />
              Tags
              {selectedTagCount > 0 && (
                <span
                  className="inline-flex items-center justify-center text-[10px] font-bold rounded-full"
                  style={{
                    minWidth: '18px',
                    height: '18px',
                    padding: '0 4px',
                    backgroundColor: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary-foreground))',
                  }}
                >
                  {selectedTagCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0" style={{ width: '240px' }}>
            {/* Tag search input */}
            <div className="p-2 border-b">
              <Input
                placeholder="Search tags..."
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                className="h-7 text-sm"
                autoFocus
              />
            </div>
            {/* Scrollable tag list */}
            <ScrollArea className="max-h-[240px] overflow-y-auto">
              <div className="p-1">
                {filteredTags.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-3">No tags found</div>
                ) : (
                  filteredTags.map((tag) => {
                    const isSelected = filters.tags?.includes(tag);
                    const tagColor = getTagColor(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left"
                        onClick={() => handleTagToggle(tag)}
                      >
                        <span
                          className="flex items-center justify-center rounded-sm border"
                          style={{
                            width: '16px',
                            height: '16px',
                            borderColor: isSelected ? tagColor.style.color as string : 'hsl(var(--border))',
                            backgroundColor: isSelected ? tagColor.style.backgroundColor as string : 'transparent',
                          }}
                        >
                          {isSelected && <Check className="w-3 h-3" style={{ color: tagColor.style.color as string }} />}
                        </span>
                        <span className="flex-1 truncate">{tag}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
            {/* Quick actions */}
            {selectedTagCount > 0 && (
              <div className="p-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => onFiltersChange({ ...filters, tags: undefined })}
                >
                  Clear all tags
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}

      {/* Selected tags as inline removable chips */}
      {filters.tags && filters.tags.length > 0 && (
        <>
          {filters.tags.map((tag) => {
            const tagColor = getTagColor(tag);
            return (
              <span
                key={tag}
                className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border cursor-pointer transition-all hover:opacity-80"
                style={tagColor.style}
                onClick={() => handleRemoveTag(tag)}
              >
                {tag}
                <X className="w-3 h-3 ml-1" />
              </span>
            );
          })}
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Hide empty toggle */}
      {onHideEmptyColumnsChange && (
        <div className="flex items-center gap-1.5">
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

      {/* Clear filters */}
      {hasActiveFilters && onClearFilters && (
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClearFilters}>
          <X className="w-3.5 h-3.5 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
