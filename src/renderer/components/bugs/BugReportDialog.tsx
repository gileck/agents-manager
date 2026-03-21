import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { X } from 'lucide-react';
import { ImagePasteArea } from '../ui/ImagePasteArea';
import type { ChatImage } from '../../../shared/types';
import type { Task } from '../../../shared/types';

export interface BugReportInitialValues {
  title?: string;
  description?: string;
  autoLoadDebugLogs?: boolean;
}

interface BugReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: BugReportInitialValues;
  /** Pre-select the source task that introduced the bug */
  initialSourceTaskId?: string;
}

export function BugReportDialog({ open, onOpenChange, initialValues, initialSourceTaskId }: BugReportDialogProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [debugLogs, setDebugLogs] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ChatImage[]>([]);

  // Task search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Extract task ID from route if on a task page
  const taskIdMatch = location.pathname.match(/\/tasks\/([^/]+)/);
  const currentTaskId = taskIdMatch?.[1] ?? null;
  const currentRoute = location.pathname;

  // Load the pre-filled task if initialSourceTaskId is provided
  useEffect(() => {
    if (open && initialSourceTaskId) {
      window.api.tasks.get(initialSourceTaskId).then((task) => {
        if (task) {
          setSelectedTask(task);
          setSearchQuery(task.title);
        }
      }).catch((err) => {
        reportError(err, 'Pre-fill source task');
      });
    }
  }, [open, initialSourceTaskId]);

  // Reset form when dialog opens, pre-fill from initialValues if provided
  useEffect(() => {
    if (open) {
      setTitle(initialValues?.title ?? '');
      setDescription(initialValues?.description ?? '');
      setDebugLogs('');
      setError(null);
      setLoadingLogs(null);
      setImages([]);
      if (!initialSourceTaskId) {
        setSelectedTask(null);
        setSearchQuery('');
      }
      setSearchResults([]);
      setShowDropdown(false);
    }
  }, [open, initialValues, initialSourceTaskId]);

  // Auto-load debug logs when opened with autoLoadDebugLogs
  useEffect(() => {
    if (!open || !initialValues?.autoLoadDebugLogs || !currentTaskId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingLogs('timeline');
        try {
          const timeline = await window.api.tasks.debugTimeline(currentTaskId);
          if (cancelled) return;
          const formatted = timeline.slice(0, 50).map((entry) => {
            const time = new Date(entry.timestamp).toISOString();
            return `[${time}] [${entry.source}/${entry.severity}] ${entry.title}`;
          }).join('\n');
          setDebugLogs((prev) => prev ? `${prev}\n\n--- Timeline (task ${currentTaskId}) ---\n${formatted}` : `--- Timeline (task ${currentTaskId}) ---\n${formatted}`);
        } catch (err) {
          console.warn('[BugReportDialog] Auto-load timeline failed:', err);
          if (!cancelled) {
            setDebugLogs((prev) => prev ? `${prev}\n\n--- Timeline: failed to auto-load ---` : '--- Timeline: failed to auto-load (use buttons to retry) ---');
          }
        }

        if (cancelled) return;
        setLoadingLogs('events');
        try {
          const events = await window.api.events.list({ taskId: currentTaskId });
          if (cancelled) return;
          const formatted = events.slice(0, 50).map((event) => {
            const time = new Date(event.createdAt).toISOString();
            return `[${time}] [${event.category}/${event.severity}] ${event.message}`;
          }).join('\n');
          setDebugLogs((prev) => prev ? `${prev}\n\n--- Events (task ${currentTaskId}) ---\n${formatted}` : `--- Events (task ${currentTaskId}) ---\n${formatted}`);
        } catch (err) {
          console.warn('[BugReportDialog] Auto-load events failed:', err);
          if (!cancelled) {
            setDebugLogs((prev) => prev ? `${prev}\n\n--- Events: failed to auto-load ---` : '--- Events: failed to auto-load (use buttons to retry) ---');
          }
        }
      } finally {
        if (!cancelled) setLoadingLogs(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, initialValues?.autoLoadDebugLogs, currentTaskId]);

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
        setSearchResults(tasks.slice(0, 20));
        setShowDropdown(true);
      } catch (err) {
        reportError(err, 'Task search');
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

  const handleClearSourceTask = useCallback(() => {
    setSelectedTask(null);
    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
  }, []);

  const handleLoadTimeline = async () => {
    if (!currentTaskId || loadingLogs) return;
    setLoadingLogs('timeline');
    try {
      const timeline = await window.api.tasks.debugTimeline(currentTaskId);
      const formatted = timeline.slice(0, 50).map((entry) => {
        const time = new Date(entry.timestamp).toISOString();
        return `[${time}] [${entry.source}/${entry.severity}] ${entry.title}`;
      }).join('\n');
      setDebugLogs((prev) => prev ? `${prev}\n\n--- Timeline (task ${currentTaskId}) ---\n${formatted}` : `--- Timeline (task ${currentTaskId}) ---\n${formatted}`);
    } catch (err) {
      reportError(err, 'Load timeline');
    } finally {
      setLoadingLogs(null);
    }
  };

  const handleLoadContext = async () => {
    if (!currentTaskId || loadingLogs) return;
    setLoadingLogs('context');
    try {
      const entries = await window.api.tasks.contextEntries(currentTaskId);
      const formatted = entries.map((entry) => {
        const time = new Date(entry.createdAt).toISOString();
        return `[${time}] [${entry.source}/${entry.entryType}] ${entry.summary}`;
      }).join('\n');
      setDebugLogs((prev) => prev ? `${prev}\n\n--- Context Entries (task ${currentTaskId}) ---\n${formatted}` : `--- Context Entries (task ${currentTaskId}) ---\n${formatted}`);
    } catch (err) {
      reportError(err, 'Load context entries');
    } finally {
      setLoadingLogs(null);
    }
  };

  const handleLoadEvents = async () => {
    if (!currentTaskId || loadingLogs) return;
    setLoadingLogs('events');
    try {
      const events = await window.api.events.list({ taskId: currentTaskId });
      const formatted = events.slice(0, 50).map((event) => {
        const time = new Date(event.createdAt).toISOString();
        return `[${time}] [${event.category}/${event.severity}] ${event.message}`;
      }).join('\n');
      setDebugLogs((prev) => prev ? `${prev}\n\n--- Events (task ${currentTaskId}) ---\n${formatted}` : `--- Events (task ${currentTaskId}) ---\n${formatted}`);
    } catch (err) {
      reportError(err, 'Load events');
    } finally {
      setLoadingLogs(null);
    }
  };

  /** Internal helper: creates the bug task and returns it */
  const doCreateBug = async (): Promise<Task | null> => {
    const settings = await window.api.settings.get();
    const projectId = settings.currentProjectId;
    if (!projectId) {
      setError('Select a project first in Settings');
      return null;
    }

    let pipelineId = settings.defaultPipelineId;
    if (!pipelineId) {
      const pipelines = await window.api.pipelines.list();
      if (pipelines.length === 0) {
        setError('No pipelines configured');
        return null;
      }
      pipelineId = pipelines[0].id;
    }

    // Build rich description
    const sections: string[] = [];

    if (description.trim()) {
      sections.push('## Description', description.trim());
    }

    // Save screenshots if any
    if (images.length > 0) {
      try {
        const { paths } = await window.api.screenshots.save(images);
        if (paths.length > 0) {
          sections.push('', '## Screenshots');
          paths.forEach((p, i) => sections.push(`![screenshot-${i + 1}](${p})`));
        }
      } catch (err) {
        reportError(err, 'Save screenshots');
      }
    }

    sections.push('', '## Context', `- **Route:** \`${currentRoute}\``);
    if (currentTaskId) {
      sections.push(`- **Related Task:** \`${currentTaskId}\``);
    }
    if (selectedTask) {
      sections.push(`- **Source Task:** \`${selectedTask.id}\` — ${selectedTask.title}`);
    }

    const task = await window.api.tasks.create({
      projectId,
      pipelineId,
      title: `[Bug] ${title.trim()}`,
      description: sections.join('\n'),
      debugInfo: debugLogs.trim() || undefined,
      type: 'bug',
      tags: ['bug'],
      metadata: {
        ...(currentTaskId ? { relatedTaskId: currentTaskId } : {}),
        ...(selectedTask ? { sourceTaskId: selectedTask.id } : {}),
        route: currentRoute,
      },
    });

    // Add 'defective' tag to the source task if one was selected (de-duplicated)
    if (selectedTask) {
      try {
        const freshTask = await window.api.tasks.get(selectedTask.id);
        const existingTags = freshTask?.tags ?? [];
        if (!existingTags.includes('defective')) {
          await window.api.tasks.update(selectedTask.id, {
            tags: [...existingTags, 'defective'],
          });
        }
      } catch (tagErr) {
        // Non-fatal: bug task was already created
        reportError(tagErr, 'Add defective tag');
      }
    }

    return task;
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const task = await doCreateBug();
      if (!task) return;

      toast.success('Bug report created', {
        ...(selectedTask ? { description: `Linked to "${selectedTask.title}"` } : {}),
        action: {
          label: 'View Task',
          onClick: () => navigate(`/tasks/${task.id}`),
        },
      });
      onOpenChange(false);
    } catch (err) {
      reportError(err, 'Create bug report');
      setError(err instanceof Error ? err.message : 'Failed to create bug report');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitAndTriage = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const task = await doCreateBug();
      if (!task) return;

      // Transition to triaging (triggers the triager agent via pipeline hook)
      await window.api.tasks.transition(task.id, 'triaging', 'admin');

      toast.success('Bug report created + triaging started', {
        action: {
          label: 'View Task',
          onClick: () => navigate(`/tasks/${task.id}`),
        },
      });
      onOpenChange(false);
    } catch (err) {
      reportError(err, 'Submit + Triage');
      setError(err instanceof Error ? err.message : 'Failed to create bug report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report Bug</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the bug"
              autoFocus={!initialSourceTaskId}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual behavior..."
            />
          </div>

          <div className="space-y-2">
            <Label>Screenshots</Label>
            <ImagePasteArea images={images} onImagesChange={setImages} />
          </div>

          {/* Context info */}
          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <p className="font-medium text-muted-foreground">Context (auto-captured)</p>
            <p>Route: <code className="bg-background px-1 rounded">{currentRoute}</code></p>
            {currentTaskId && (
              <p>Task: <code className="bg-background px-1 rounded">{currentTaskId}</code></p>
            )}
          </div>

          {/* Debug logs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Debug Logs</Label>
              {currentTaskId && (
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={handleLoadTimeline} disabled={!!loadingLogs}>
                    {loadingLogs === 'timeline' ? 'Loading...' : 'Load Timeline'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLoadContext} disabled={!!loadingLogs}>
                    {loadingLogs === 'context' ? 'Loading...' : 'Load Context'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLoadEvents} disabled={!!loadingLogs}>
                    {loadingLogs === 'events' ? 'Loading...' : 'Load Events'}
                  </Button>
                </div>
              )}
            </div>
            <Textarea
              rows={6}
              value={debugLogs}
              onChange={(e) => setDebugLogs(e.target.value)}
              placeholder={currentTaskId
                ? 'Use the buttons above to load logs, or paste debug info here...'
                : 'Paste any debug info, error messages, or logs here...'}
              className="font-mono text-xs"
            />
            {debugLogs && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setDebugLogs('')}
              >
                <X className="h-3 w-3 mr-1" /> Clear logs
              </Button>
            )}
          </div>

          {/* Source task picker */}
          <div className="space-y-2">
            <Label>Source Task</Label>
            <div className="relative" ref={dropdownRef}>
              <Input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search for the task that introduced the bug…"
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
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Selected: <span className="font-medium text-foreground">{selectedTask.title}</span>
                  {' '}— will be tagged <span className="font-mono">defective</span>
                </span>
                <button
                  onClick={handleClearSourceTask}
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  title="Clear selection"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {error && <InlineError message={error} context="Bug report" />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <div className="inline-flex gap-1">
            <Button
              onClick={handleSubmit}
              disabled={submitting || !title.trim()}
            >
              {submitting ? 'Submitting...' : 'Submit Bug Report'}
            </Button>
            <Button
              variant="outline"
              onClick={handleSubmitAndTriage}
              disabled={submitting || !title.trim()}
              title="Submit the bug report and immediately start triaging"
            >
              Submit + Triage
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
