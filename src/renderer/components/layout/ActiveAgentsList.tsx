import React from 'react';
import { NavLink } from 'react-router-dom';
import { RefreshCw, Check, X, CircleDot } from 'lucide-react';
import { cn } from '@template/renderer/lib/utils';
import { useActiveAgentRuns } from '../../hooks/useActiveAgentRuns';
import { formatRelativeTimestamp } from '../tasks/task-helpers';
import type { AgentRunStatus } from '../../../shared/types';

function StatusIndicator({ status }: { status: AgentRunStatus }) {
  if (status === 'running') {
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
      </span>
    );
  }
  if (status === 'completed') {
    return <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />;
  }
  if (status === 'failed' || status === 'timed_out' || status === 'cancelled') {
    return <X className="h-3.5 w-3.5 text-red-500 shrink-0" />;
  }
  return <CircleDot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.floor((now - startedAt) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <span className="text-[10px] text-muted-foreground tabular-nums">
      {minutes}:{seconds.toString().padStart(2, '0')}
    </span>
  );
}

export function ActiveAgentsList() {
  const { entries, refresh } = useActiveAgentRuns();

  if (entries.length === 0) return null;

  return (
    <ActiveAgentsEntries entries={entries} refresh={refresh} />
  );
}

export function ActiveAgentsEntries({
  entries,
  refresh,
}: {
  entries: ReturnType<typeof useActiveAgentRuns>['entries'];
  refresh: () => void;
}) {
  return (
    <div className="max-h-48 overflow-y-auto px-2">
      {entries.map(({ run, taskTitle }) => (
        <NavLink
          key={run.id}
          to={`/agents/${run.id}`}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors mb-0.5',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )
          }
        >
          <StatusIndicator status={run.status} />
          <div className="flex-1 min-w-0">
            <div className="truncate">{taskTitle}</div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] opacity-70">{run.mode}</span>
              {run.status === 'running' && <ElapsedTime startedAt={run.startedAt} />}
              {run.status !== 'running' && run.completedAt && (
                <span className="text-[10px] text-muted-foreground">
                  {formatRelativeTimestamp(run.completedAt)}
                </span>
              )}
            </div>
          </div>
        </NavLink>
      ))}
      {entries.length > 0 && (
        <button
          onClick={refresh}
          className="flex items-center gap-1 w-full rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-0.5"
          title="Clear completed"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          Clear completed
        </button>
      )}
    </div>
  );
}
