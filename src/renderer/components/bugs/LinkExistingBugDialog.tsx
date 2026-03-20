import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { reportError } from '../../lib/error-handler';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import type { Task } from '../../../shared/types';

interface LinkExistingBugDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The source task to link the bug to */
  taskId: string;
  /** Bug IDs already linked to this task — excluded from search results */
  excludeBugIds: string[];
}

export function LinkExistingBugDialog({ open, onOpenChange, taskId, excludeBugIds }: LinkExistingBugDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Task[]>([]);
  const [selectedBug, setSelectedBug] = useState<Task | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setSearchResults([]);
      setSelectedBug(null);
      setShowDropdown(false);
      setSubmitting(false);
    }
  }, [open]);

  // Clear debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSelectedBug(null);
    setShowDropdown(true);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!value.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const tasks = await window.api.tasks.list({ type: 'bug', search: value });
        // Safety: ensure only bugs are shown, and exclude already-linked bugs
        const filtered = tasks
          .filter((t) => t.type === 'bug')
          .filter((t) => !excludeBugIds.includes(t.id));
        setSearchResults(filtered.slice(0, 20));
        setShowDropdown(true);
      } catch (err) {
        reportError(err, 'Bug search');
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [excludeBugIds]);

  const handleSelectBug = useCallback((bug: Task) => {
    setSelectedBug(bug);
    setSearchQuery(bug.title);
    setShowDropdown(false);
    setSearchResults([]);
  }, []);

  const handleLink = async () => {
    if (!selectedBug) return;
    setSubmitting(true);

    try {
      // Fetch the bug to get its current metadata, then merge sourceTaskId
      const freshBug = await window.api.tasks.get(selectedBug.id);
      if (!freshBug) {
        throw new Error('Bug task not found');
      }

      const existingMetadata = (freshBug.metadata as Record<string, unknown>) ?? {};
      await window.api.tasks.update(selectedBug.id, {
        metadata: { ...existingMetadata, sourceTaskId: taskId },
      });

      // Add 'defective' tag to the source task (de-duplicated)
      try {
        const sourceTask = await window.api.tasks.get(taskId);
        const existingTags = sourceTask?.tags ?? [];
        if (!existingTags.includes('defective')) {
          await window.api.tasks.update(taskId, {
            tags: [...existingTags, 'defective'],
          });
        }
      } catch (tagErr) {
        // Non-fatal: the bug was already linked
        reportError(tagErr, 'Add defective tag');
      }

      toast.success('Bug linked', {
        description: `"${selectedBug.title}" linked to this task`,
      });
      onOpenChange(false);
    } catch (err) {
      reportError(err, 'Link existing bug');
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = (status: string) => {
    if (status === 'closed' || status === 'done' || status === 'merged') return 'default' as const;
    if (status === 'in_progress' || status === 'implementing') return 'secondary' as const;
    return 'outline' as const;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link Existing Bug</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Search Bugs</Label>
            <div className="relative" ref={dropdownRef}>
              <Input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search for a bug task to link..."
                autoFocus
              />
              {searching && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  Searching...
                </div>
              )}
              {showDropdown && searchQuery.trim() && (
                <div
                  className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md"
                  style={{ maxHeight: 240, overflowY: 'auto' }}
                >
                  {searchResults.length === 0 && !searching ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No bugs found
                    </div>
                  ) : (
                    searchResults.map((bug) => (
                      <div
                        key={bug.id}
                        className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-accent text-sm"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectBug(bug);
                        }}
                      >
                        <span className="truncate flex-1">{bug.title}</span>
                        <Badge variant={statusColor(bug.status)} className="text-xs shrink-0">
                          {bug.status}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {selectedBug && (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{selectedBug.title}</span>
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleLink}
            disabled={submitting || !selectedBug}
          >
            {submitting ? 'Linking...' : 'Link Bug'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
