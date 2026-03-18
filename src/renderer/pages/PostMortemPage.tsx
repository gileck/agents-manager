import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Bug, ChevronDown, ChevronRight, Loader2, Play } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import { reportError } from '../lib/error-handler';
import type { Task, TaskContextEntry } from '../../shared/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuggestedTask {
  title: string;
  description?: string;
  type?: string;
  priority?: number;
  size?: string;
  complexity?: string;
  startPhase?: string;
}

interface PostMortemData {
  rootCause?: string;
  severity?: string;
  responsibleAgents?: string[];
  analysis?: string;
  promptImprovements?: string[];
  processImprovements?: string[];
  suggestedTasks?: SuggestedTask[];
}

// ─── Colour maps ─────────────────────────────────────────────────────────────

const ROOT_CAUSE_COLORS: Record<string, { bg: string; text: string }> = {
  missed_edge_case: { bg: '#f59e0b', text: 'white' },
  design_flaw: { bg: '#dc2626', text: 'white' },
  incomplete_requirements: { bg: '#7c3aed', text: 'white' },
  inadequate_review: { bg: '#f97316', text: 'white' },
  missing_tests: { bg: '#0ea5e9', text: 'white' },
  other: { bg: '#6b7280', text: 'white' },
};

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  minor: { bg: '#22c55e', text: 'white' },
  moderate: { bg: '#f59e0b', text: 'white' },
  major: { bg: '#dc2626', text: 'white' },
};

// ─── Trigger post-mortem dialog ───────────────────────────────────────────────

interface TriggerPostMortemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  onTriggered: () => void;
}

function TriggerPostMortemDialog({
  open,
  onOpenChange,
  task,
  onTriggered,
}: TriggerPostMortemDialogProps) {
  const [postMortemInput, setPostMortemInput] = useState('');
  const [linkedBugs, setLinkedBugs] = useState<Task[]>([]);
  const [loadingBugs, setLoadingBugs] = useState(false);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    if (!open) return;
    const rawInput = task.metadata?.postMortemInput;
    setPostMortemInput(typeof rawInput === 'string' ? rawInput : '');
    setLoadingBugs(true);
    window.api.tasks.list({ type: 'bug' }).then((bugs) => {
      const linked = bugs.filter(
        (b) => (b.metadata as Record<string, unknown> | undefined)?.sourceTaskId === task.id,
      );
      setLinkedBugs(linked);
    }).catch((err) => {
      reportError(err, 'Load linked bugs');
    }).finally(() => setLoadingBugs(false));
  }, [open, task]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const linkedBugDescriptions = linkedBugs.map(
        (b) => `Title: ${b.title}\n${b.description ?? ''}`.trim(),
      );
      await window.api.tasks.postMortem(task.id, { postMortemInput, linkedBugDescriptions });
      toast.success('Post-mortem analysis started');
      onOpenChange(false);
      onTriggered();
    } catch (err) {
      reportError(err, 'Trigger post-mortem');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Run Post-Mortem Analysis</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <span className="font-medium">Task:</span>{' '}
            <span>{task.title}</span>
          </div>

          {loadingBugs ? (
            <p className="text-xs text-muted-foreground">Loading linked bugs…</p>
          ) : linkedBugs.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs">Linked Bugs ({linkedBugs.length})</Label>
              <div className="rounded-md border divide-y text-xs">
                {linkedBugs.map((bug) => (
                  <div key={bug.id} className="px-3 py-1.5 flex items-center gap-2">
                    <Bug className="h-3 w-3 text-destructive shrink-0" />
                    <span className="truncate">{bug.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No linked bug tasks found for this task.</p>
          )}

          <div className="space-y-1.5">
            <Label>Expected vs. Actual (what went wrong?)</Label>
            <Textarea
              rows={5}
              value={postMortemInput}
              onChange={(e) => setPostMortemInput(e.target.value)}
              placeholder="Describe what was expected and what actually happened. The agent will use this together with the task plan, design, and linked bugs to identify root causes…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleTrigger} disabled={triggering}>
            {triggering ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Run Post-Mortem
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Post-mortem results display ─────────────────────────────────────────────

function PostMortemResults({
  data,
  taskId,
  onTaskCreated,
}: {
  data: PostMortemData;
  taskId: string;
  onTaskCreated: () => void;
}) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState<string | null>(null);

  const handleCreateTask = async (suggested: SuggestedTask) => {
    setCreating(suggested.title);
    try {
      const settings = await window.api.settings.get();
      const projectId = settings.currentProjectId;
      if (!projectId) { toast.error('No project selected'); return; }

      let pipelineId = settings.defaultPipelineId;
      if (!pipelineId) {
        const pipelines = await window.api.pipelines.list();
        pipelineId = pipelines[0]?.id;
      }
      if (!pipelineId) { toast.error('No pipeline configured'); return; }

      const created = await window.api.tasks.create({
        projectId,
        pipelineId,
        title: suggested.title,
        description: suggested.description,
        type: (suggested.type ?? 'improvement') as 'bug' | 'feature' | 'improvement',
        priority: typeof suggested.priority === 'number' ? suggested.priority : 2,
        tags: ['post-mortem'],
        metadata: { sourceTaskId: taskId },
        createdBy: 'user',
      });

      toast.success('Task created', {
        action: { label: 'View', onClick: () => navigate(`/tasks/${created.id}`) },
      });
      onTaskCreated();
    } catch (err) {
      reportError(err, 'Create task');
    } finally {
      setCreating(null);
    }
  };

  const rootCauseStyle = data.rootCause ? ROOT_CAUSE_COLORS[data.rootCause] : undefined;
  const severityStyle = data.severity ? SEVERITY_COLORS[data.severity] : undefined;

  return (
    <div className="space-y-4 mt-4">
      {/* Root cause + severity badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {data.rootCause && (
          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
            style={rootCauseStyle ? { backgroundColor: rootCauseStyle.bg, color: rootCauseStyle.text } : {}}
          >
            {data.rootCause.replace(/_/g, ' ')}
          </span>
        )}
        {data.severity && (
          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
            style={severityStyle ? { backgroundColor: severityStyle.bg, color: severityStyle.text } : {}}
          >
            {data.severity} severity
          </span>
        )}
        {Array.isArray(data.responsibleAgents) && data.responsibleAgents.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Should have been caught by:{' '}
            <span className="font-medium text-foreground">
              {data.responsibleAgents.join(', ')}
            </span>
          </span>
        )}
      </div>

      {/* Analysis */}
      {data.analysis && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Analysis</p>
          <p className="text-sm whitespace-pre-wrap">{data.analysis}</p>
        </div>
      )}

      {/* Prompt improvements */}
      {Array.isArray(data.promptImprovements) && data.promptImprovements.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Prompt Improvements
          </p>
          <ul className="space-y-1">
            {data.promptImprovements.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-muted-foreground shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Process improvements */}
      {Array.isArray(data.processImprovements) && data.processImprovements.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Process Improvements
          </p>
          <ul className="space-y-1">
            {data.processImprovements.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="text-muted-foreground shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggested tasks */}
      {Array.isArray(data.suggestedTasks) && data.suggestedTasks.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Suggested Tasks
          </p>
          <div className="space-y-2">
            {data.suggestedTasks.map((suggested, i) => (
              <div key={i} className="rounded-md border p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{suggested.title}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs shrink-0"
                    disabled={creating === suggested.title}
                    onClick={() => handleCreateTask(suggested)}
                  >
                    {creating === suggested.title ? 'Creating…' : 'Create Task'}
                  </Button>
                </div>
                {suggested.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{suggested.description}</p>
                )}
                <div className="flex gap-1 flex-wrap">
                  {suggested.type && (
                    <Badge variant="outline" className="text-xs">{suggested.type}</Badge>
                  )}
                  {suggested.size && (
                    <Badge variant="outline" className="text-xs">{suggested.size}</Badge>
                  )}
                  {typeof suggested.priority === 'number' && (
                    <Badge variant="outline" className="text-xs">P{suggested.priority}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

interface DefectiveTaskRowProps {
  task: Task;
  pendingReview: boolean;
  onRefresh: () => void;
}

function DefectiveTaskRow({ task, pendingReview, onRefresh }: DefectiveTaskRowProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [contextEntries, setContextEntries] = useState<TaskContextEntry[] | null>(null);
  const [linkedBugCount, setLinkedBugCount] = useState<number | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);

  // Lazily load context + bug count when expanded
  const handleExpand = useCallback(async () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && contextEntries === null) {
      setLoadingContext(true);
      try {
        const [entries, bugs] = await Promise.all([
          window.api.tasks.contextEntries(task.id),
          window.api.tasks.list({ type: 'bug' }).then((all) =>
            all.filter(
              (b) => (b.metadata as Record<string, unknown> | undefined)?.sourceTaskId === task.id,
            ),
          ),
        ]);
        setContextEntries(entries);
        setLinkedBugCount(bugs.length);
      } catch (err) {
        reportError(err, 'Load post-mortem context');
        setExpanded(false);
      } finally {
        setLoadingContext(false);
      }
    }
  }, [expanded, contextEntries, task.id]);

  const postMortemEntry = contextEntries?.find((e) => e.entryType === 'post_mortem');
  const postMortemData = postMortemEntry?.data as PostMortemData | undefined;

  const severityStyle = postMortemData?.severity
    ? SEVERITY_COLORS[postMortemData.severity]
    : undefined;

  return (
    <>
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer rounded-md"
        onClick={handleExpand}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{task.title}</p>
          <p className="text-xs text-muted-foreground">{task.status}</p>
        </div>

        {/* Severity badge if review complete */}
        {postMortemData?.severity && (
          <span
            className="px-2 py-0.5 rounded-full text-xs font-semibold shrink-0"
            style={severityStyle ? { backgroundColor: severityStyle.bg, color: severityStyle.text } : {}}
          >
            {postMortemData.severity}
          </span>
        )}

        {/* Linked bug count */}
        {linkedBugCount !== null && linkedBugCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Bug className="h-3 w-3 text-destructive" />
            {linkedBugCount}
          </span>
        )}

        {pendingReview && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setTriggerOpen(true);
            }}
          >
            <Play className="h-3.5 w-3.5 mr-1" />
            Run Post-Mortem
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/tasks/${task.id}`);
          }}
        >
          View Task
        </Button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-10 pb-4">
          {loadingContext ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : postMortemData ? (
            <PostMortemResults
              data={postMortemData}
              taskId={task.id}
              onTaskCreated={onRefresh}
            />
          ) : (
            <p className="text-xs text-muted-foreground py-2">
              {pendingReview
                ? 'No post-mortem analysis yet. Click "Run Post-Mortem" to start.'
                : 'Post-mortem analysis not available.'}
            </p>
          )}
        </div>
      )}

      <TriggerPostMortemDialog
        open={triggerOpen}
        onOpenChange={setTriggerOpen}
        task={task}
        onTriggered={onRefresh}
      />
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PostMortemPage() {
  const [defectiveTasks, setDefectiveTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const tasks = await window.api.tasks.list({ tag: 'defective' });
      setDefectiveTasks(tasks);
    } catch (err) {
      reportError(err, 'Load defective tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const pendingTasks = defectiveTasks.filter((t) => !t.tags.includes('post-mortem-done'));
  const completedTasks = defectiveTasks.filter((t) => t.tags.includes('post-mortem-done'));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Bug className="h-5 w-5 text-destructive" />
        <h1 className="text-xl font-semibold">Post-Mortem Review</h1>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading defective tasks…
        </div>
      ) : defectiveTasks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No tasks tagged <span className="font-mono">defective</span> yet.
            <br />
            When a bug task is linked to a source task, that task will be tagged{' '}
            <span className="font-mono">defective</span> and appear here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Pending review */}
          {pendingTasks.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  Pending Review
                  <Badge variant="destructive" className="text-xs">{pendingTasks.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3 space-y-1">
                {pendingTasks.map((task) => (
                  <DefectiveTaskRow
                    key={task.id}
                    task={task}
                    pendingReview
                    onRefresh={fetchTasks}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Review complete */}
          {completedTasks.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  Review Complete
                  <Badge variant="secondary" className="text-xs">{completedTasks.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3 space-y-1">
                {completedTasks.map((task) => (
                  <DefectiveTaskRow
                    key={task.id}
                    task={task}
                    pendingReview={false}
                    onRefresh={fetchTasks}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
