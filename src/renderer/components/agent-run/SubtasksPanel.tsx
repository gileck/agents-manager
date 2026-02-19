import React from 'react';
import { Badge } from '../ui/badge';
import { Circle, Loader2, CheckCircle2 } from 'lucide-react';
import type { Subtask } from '../../../shared/types';

interface SubtasksPanelProps {
  subtasks: Subtask[];
}

const statusIcon: Record<string, React.ReactNode> = {
  open: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
  in_progress: <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
};

const statusVariant: Record<string, 'outline' | 'default' | 'success'> = {
  open: 'outline',
  in_progress: 'default',
  done: 'success',
};

export function SubtasksPanel({ subtasks }: SubtasksPanelProps) {
  if (!subtasks || subtasks.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">No subtasks defined.</p>;
  }

  const doneCount = subtasks.filter((s) => s.status === 'done').length;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: `${(doneCount / subtasks.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {doneCount}/{subtasks.length} complete
        </span>
      </div>

      <div className="space-y-1">
        {subtasks.map((st, i) => (
          <div key={i} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50">
            {statusIcon[st.status] ?? statusIcon.open}
            <span className="text-sm flex-1 truncate">{st.name}</span>
            <Badge variant={statusVariant[st.status] ?? 'outline'} className="text-xs">
              {st.status.replace('_', ' ')}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
