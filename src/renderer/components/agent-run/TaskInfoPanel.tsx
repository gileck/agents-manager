import React, { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { GitBranch, ExternalLink } from 'lucide-react';
import type { Task, AgentRun } from '../../../shared/types';

interface TaskInfoPanelProps {
  task: Task;
  run: AgentRun;
}

export function TaskInfoPanel({ task, run }: TaskInfoPanelProps) {
  const [planExpanded, setPlanExpanded] = useState(false);

  const planLines = task.plan?.split('\n') ?? [];
  const planPreview = planLines.slice(0, 5).join('\n');
  const planHasMore = planLines.length > 5;

  return (
    <div className="p-4 space-y-4">
      {/* Title & status */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-sm">{task.title}</h3>
          <Badge variant="outline" className="text-xs">{task.status}</Badge>
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-3">{task.description}</p>
        )}
      </div>

      {/* Plan summary */}
      {task.plan && (
        <div>
          <h4 className="text-xs font-medium mb-1">Plan</h4>
          <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">
            {planExpanded ? task.plan : planPreview}
          </pre>
          {planHasMore && (
            <Button
              variant="link"
              size="sm"
              className="text-xs p-0 h-auto mt-1"
              onClick={() => setPlanExpanded((e) => !e)}
            >
              {planExpanded ? 'Show less' : `Show all (${planLines.length} lines)`}
            </Button>
          )}
        </div>
      )}

      {/* Branch & PR */}
      <div className="flex flex-wrap gap-4 text-xs">
        {task.branchName && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            <code>{task.branchName}</code>
          </div>
        )}
        {task.prLink && (
          <a
            href={task.prLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-blue-500 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            PR
          </a>
        )}
      </div>

      {/* Token usage */}
      {(run.costInputTokens != null || run.costOutputTokens != null) && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Tokens:</span>{' '}
          {run.costInputTokens?.toLocaleString() ?? 0} input / {run.costOutputTokens?.toLocaleString() ?? 0} output
        </div>
      )}
    </div>
  );
}
