import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { RefreshCw } from 'lucide-react';
import { reportError } from '../lib/error-handler';
import { AgentRunsTable } from '../components/agent-run/AgentRunsTable';
import type { AgentRun, Task } from '../../shared/types';

export function AgentRunsListPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map());
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const allRuns = await window.api.agents.allRuns();
      setRuns(allRuns);

      // Fetch task names for display
      const taskIds = [...new Set(allRuns.map((r: AgentRun) => r.taskId))];
      const taskMap = new Map<string, Task>();
      await Promise.all(
        taskIds.map(async (id) => {
          try {
            const task = await window.api.tasks.get(id);
            if (task) taskMap.set(id, task);
          } catch { /* task may be deleted */ }
        }),
      );
      setTasks(taskMap);
    } catch (err) {
      reportError(err, 'Fetch agent runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchRuns, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchRuns]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agent Runs</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
          <Button variant="outline" size="sm" onClick={fetchRuns} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <AgentRunsTable
        runs={runs}
        tasks={tasks}
        showTaskColumn
        loading={loading}
        onNavigateToRun={(runId) => navigate(`/agents/${runId}`)}
      />
    </div>
  );
}
