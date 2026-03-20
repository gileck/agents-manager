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

interface LinkExistingTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The source task to link the selected task to */
  taskId: string;
  /** Task IDs already linked — excluded from search results */
  excludeTaskIds: string[];
}

export function LinkExistingTaskDialog({ open, onOpenChange, taskId, excludeTaskIds }: LinkExistingTaskDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
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
      setSelectedTask(null);
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
    setSelectedTask(null);
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
        const tasks = await window.api.tasks.list({ search: value });
        const filtered = tasks
          .filter((t) => !excludeTaskIds.includes(t.id))
          .filter((t) => t.id !== taskId);
        setSearchResults(filtered.slice(0, 20));
        setShowDropdown(true);
      } catch (err) {
        reportError(err, 'Task search');
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [excludeTaskIds, taskId]);

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTask(task);
    setSearchQuery(task.title);
    setShowDropdown(false);
    setSearchResults([]);
  }, []);

  const handleLink = async () => {
    if (!selectedTask) return;
    setSubmitting(true);

    try {
      // Fetch the task to get its current metadata, then merge sourceTaskId
      const freshTask = await window.api.tasks.get(selectedTask.id);
      if (!freshTask) {
        throw new Error('Task not found');
      }

      const existingMetadata = (freshTask.metadata as Record<string, unknown>) ?? {};
      await window.api.tasks.update(selectedTask.id, {
        metadata: { ...existingMetadata, sourceTaskId: taskId },
      });

      // Add 'defective' tag to the source task only when the linked task is a bug
      const isBug = selectedTask.type === 'bug' || selectedTask.tags?.includes('bug');
      if (isBug) {
        try {
          const sourceTask = await window.api.tasks.get(taskId);
          const existingTags = sourceTask?.tags ?? [];
          if (!existingTags.includes('defective')) {
            await window.api.tasks.update(taskId, {
              tags: [...existingTags, 'defective'],
            });
          }
        } catch (tagErr) {
          // Non-fatal: the task was already linked
          reportError(tagErr, 'Add defective tag');
        }
      }

      toast.success('Task linked', {
        description: `"${selectedTask.title}" linked to this task`,
      });
      onOpenChange(false);
    } catch (err) {
      reportError(err, 'Link existing task');
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
          <DialogTitle>Link Existing Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Search Tasks</Label>
            <div className="relative" ref={dropdownRef}>
              <Input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search for a task to link..."
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
                      No tasks found
                    </div>
                  ) : (
                    searchResults.map((task) => (
                      <div
                        key={task.id}
                        className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-accent text-sm"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectTask(task);
                        }}
                      >
                        <span className="truncate flex-1">{task.title}</span>
                        <Badge variant="outline" className="text-xs shrink-0 capitalize">
                          {task.type}
                        </Badge>
                        <Badge variant={statusColor(task.status)} className="text-xs shrink-0">
                          {task.status}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {selectedTask && (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{selectedTask.title}</span>
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleLink}
            disabled={submitting || !selectedTask}
          >
            {submitting ? 'Linking...' : 'Link Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
