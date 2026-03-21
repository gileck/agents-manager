import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { PlanMarkdown } from '../task-detail/PlanMarkdown';
import { reportError } from '../../lib/error-handler';
import type { PostMortemData, PostMortemSuggestedTask } from '../../../shared/types';

// Re-export for consumers that import from this file
export type { PostMortemData } from '../../../shared/types';

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

// ─── Component ────────────────────────────────────────────────────────────────

interface PostMortemReportProps {
  data: PostMortemData;
  taskId: string;
  onTaskCreated: () => void;
}

export function PostMortemReport({ data, taskId, onTaskCreated }: PostMortemReportProps) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState<string | null>(null);

  const handleCreateTask = async (suggested: PostMortemSuggestedTask) => {
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

  // Build analysis as markdown for rendering
  const markdownParts: string[] = [];

  if (data.analysis) {
    markdownParts.push('## Analysis\n');
    markdownParts.push(data.analysis);
    markdownParts.push('');
  }

  const codebaseImprovements = data.codebaseImprovements ?? data.processImprovements;
  if (Array.isArray(codebaseImprovements) && codebaseImprovements.length > 0) {
    markdownParts.push('## Codebase Improvements\n');
    codebaseImprovements.forEach((item) => markdownParts.push(`- ${item}`));
    markdownParts.push('');
  }

  return (
    <div className="space-y-6">
      {/* Header badges */}
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

      {/* Analysis + improvements rendered as markdown */}
      {markdownParts.length > 0 && (
        <PlanMarkdown content={markdownParts.join('\n')} />
      )}

      {/* Suggested tasks as interactive cards */}
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
                    {creating === suggested.title ? 'Creating...' : 'Create Task'}
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
