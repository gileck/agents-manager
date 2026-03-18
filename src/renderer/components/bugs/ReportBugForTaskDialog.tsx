import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { reportError } from '../../lib/error-handler';
import { InlineError } from '../InlineError';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import type { Task } from '../../../shared/types';

interface ReportBugForTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fills the task search with this task ID */
  initialSourceTaskId?: string;
}

export function ReportBugForTaskDialog({
  open,
  onOpenChange,
  initialSourceTaskId,
}: ReportBugForTaskDialogProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Task search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load the pre-filled task if initialSourceTaskId is provided
  useEffect(() => {
    if (open && initialSourceTaskId) {
      window.api.tasks.get(initialSourceTaskId).then((task) => {
        if (task) {
          setSelectedTask(task);
          setSearchQuery(task.title);
        }
      }).catch((err) => {
        console.warn('ReportBugForTaskDialog: failed to pre-fill task', err);
      });
    }
  }, [open, initialSourceTaskId]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setError(null);
      if (!initialSourceTaskId) {
        setSelectedTask(null);
        setSearchQuery('');
      }
      setSearchResults([]);
      setShowDropdown(false);
    }
  }, [open, initialSourceTaskId]);

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
        setSearchResults(tasks.slice(0, 20));
        setShowDropdown(true);
      } catch (err) {
        console.error('Task search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTask(task);
    setSearchQuery(task.title);
    setShowDropdown(false);
    setSearchResults([]);
  }, []);

  const handleSubmit = async () => {
    if (!title.trim() || !selectedTask) return;
    setSubmitting(true);
    setError(null);

    try {
      const settings = await window.api.settings.get();
      const projectId = settings.currentProjectId;
      if (!projectId) {
        setError('Select a project first in Settings');
        return;
      }

      let pipelineId = settings.defaultPipelineId;
      if (!pipelineId) {
        const pipelines = await window.api.pipelines.list();
        if (pipelines.length === 0) {
          setError('No pipelines configured');
          return;
        }
        pipelineId = pipelines[0].id;
      }

      // Create the bug task linking back to the source task
      const bugTask = await window.api.tasks.create({
        projectId,
        pipelineId,
        title: `[Bug] ${title.trim()}`,
        description: description.trim() || undefined,
        type: 'bug',
        tags: ['bug'],
        metadata: { sourceTaskId: selectedTask.id },
        createdBy: 'user',
      });

      // Add 'defective' tag to the source task (de-duped)
      try {
        const existingTags = selectedTask.tags ?? [];
        if (!existingTags.includes('defective')) {
          await window.api.tasks.update(selectedTask.id, {
            tags: [...existingTags, 'defective'],
          });
        }
      } catch (tagErr) {
        // Non-fatal: bug task was already created
        reportError(tagErr, 'Add defective tag');
      }

      toast.success('Bug task created', {
        description: `Linked to "${selectedTask.title}"`,
        action: {
          label: 'View Bug',
          onClick: () => navigate(`/tasks/${bugTask.id}`),
        },
      });
      onOpenChange(false);
    } catch (err) {
      console.error('[ReportBugForTaskDialog]', err);
      setError(err instanceof Error ? err.message : 'Failed to create bug task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report Bug for Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Source task picker */}
          <div className="space-y-2">
            <Label>Source Task <span className="text-destructive">*</span></Label>
            <div className="relative" ref={dropdownRef}>
              <Input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search for the task that introduced the bug…"
                autoFocus={!initialSourceTaskId}
                onFocus={() => {
                  if (searchResults.length > 0) setShowDropdown(true);
                }}
              />
              {searching && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  Searching…
                </div>
              )}
              {showDropdown && searchResults.length > 0 && (
                <div
                  className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md"
                  style={{ maxHeight: 240, overflowY: 'auto' }}
                >
                  {searchResults.map((task) => (
                    <div
                      key={task.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-accent text-sm"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectTask(task);
                      }}
                    >
                      <span className="truncate">{task.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{task.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedTask && (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{selectedTask.title}</span>
                {' '}— will be tagged <span className="font-mono">defective</span>
              </p>
            )}
          </div>

          {/* Bug title */}
          <div className="space-y-2">
            <Label>Bug Title <span className="text-destructive">*</span></Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the bug"
              autoFocus={!!initialSourceTaskId}
            />
          </div>

          {/* Bug description */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual behavior…"
            />
          </div>

          {error && <InlineError message={error} context="Create bug task" />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !selectedTask}
          >
            {submitting ? 'Creating…' : 'Create Bug Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
