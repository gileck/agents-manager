import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import { X } from 'lucide-react';

interface BugReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BugReportDialog({ open, onOpenChange }: BugReportDialogProps) {
  const location = useLocation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [debugLogs, setDebugLogs] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract task ID from route if on a task page
  const taskIdMatch = location.pathname.match(/\/tasks\/([^/]+)/);
  const currentTaskId = taskIdMatch?.[1] ?? null;
  const currentRoute = location.pathname;

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setDebugLogs('');
      setError(null);
    }
  }, [open]);

  const handleLoadTimeline = async () => {
    if (!currentTaskId) return;
    try {
      const timeline = await window.api.tasks.debugTimeline(currentTaskId);
      const formatted = timeline.slice(0, 50).map((entry) => {
        const time = new Date(entry.timestamp).toISOString();
        return `[${time}] [${entry.source}/${entry.severity}] ${entry.title}`;
      }).join('\n');
      setDebugLogs((prev) => prev ? `${prev}\n\n--- Timeline (task ${currentTaskId}) ---\n${formatted}` : `--- Timeline (task ${currentTaskId}) ---\n${formatted}`);
    } catch {
      toast.error('Failed to load timeline');
    }
  };

  const handleLoadContext = async () => {
    if (!currentTaskId) return;
    try {
      const entries = await window.api.tasks.contextEntries(currentTaskId);
      const formatted = entries.map((entry) => {
        const time = new Date(entry.createdAt).toISOString();
        return `[${time}] [${entry.source}/${entry.entryType}] ${entry.summary}`;
      }).join('\n');
      setDebugLogs((prev) => prev ? `${prev}\n\n--- Context Entries (task ${currentTaskId}) ---\n${formatted}` : `--- Context Entries (task ${currentTaskId}) ---\n${formatted}`);
    } catch {
      toast.error('Failed to load context entries');
    }
  };

  const handleLoadEvents = async () => {
    if (!currentTaskId) return;
    try {
      const events = await window.api.events.list({ taskId: currentTaskId });
      const formatted = events.slice(0, 50).map((event) => {
        const time = new Date(event.createdAt).toISOString();
        return `[${time}] [${event.category}/${event.severity}] ${event.message}`;
      }).join('\n');
      setDebugLogs((prev) => prev ? `${prev}\n\n--- Events (task ${currentTaskId}) ---\n${formatted}` : `--- Events (task ${currentTaskId}) ---\n${formatted}`);
    } catch {
      toast.error('Failed to load events');
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const settings = await window.api.settings.get();
      const projectId = settings.currentProjectId;
      if (!projectId) {
        setError('Select a project first in Settings');
        setSubmitting(false);
        return;
      }

      let pipelineId = settings.bugPipelineId ?? settings.defaultPipelineId;
      if (!pipelineId) {
        const pipelines = await window.api.pipelines.list();
        if (pipelines.length === 0) {
          setError('No pipelines configured');
          setSubmitting(false);
          return;
        }
        pipelineId = pipelines[0].id;
      }

      // Build rich description
      const sections: string[] = [];

      if (description.trim()) {
        sections.push('## Description', description.trim());
      }

      sections.push('', '## Context', `- **Route:** \`${currentRoute}\``);
      if (currentTaskId) {
        sections.push(`- **Related Task:** \`${currentTaskId}\``);
      }

      if (debugLogs.trim()) {
        sections.push('', '## Debug Logs', '```', debugLogs.trim(), '```');
      }

      const task = await window.api.tasks.create({
        projectId,
        pipelineId,
        title: `[Bug] ${title.trim()}`,
        description: sections.join('\n'),
        tags: ['bug'],
        metadata: {
          ...(currentTaskId ? { relatedTaskId: currentTaskId } : {}),
          route: currentRoute,
        },
      });

      toast.success('Bug report created', {
        action: {
          label: 'View Task',
          onClick: () => {
            window.location.hash = `#/tasks/${task.id}`;
          },
        },
      });
      onOpenChange(false);
    } catch (err) {
      console.error('[BugReportDialog]', err);
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
              autoFocus
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
                  <Button variant="outline" size="sm" onClick={handleLoadTimeline}>
                    Load Timeline
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLoadContext}>
                    Load Context
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLoadEvents}>
                    Load Events
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

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
          >
            {submitting ? 'Submitting...' : 'Submit Bug Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
