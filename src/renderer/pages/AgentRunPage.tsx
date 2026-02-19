import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { OutputPanel } from '../components/agent-run/OutputPanel';
import { SubtasksPanel } from '../components/agent-run/SubtasksPanel';
import { GitChangesPanel } from '../components/agent-run/GitChangesPanel';
import { TaskInfoPanel } from '../components/agent-run/TaskInfoPanel';
import type { AgentRun, Task } from '../../shared/types';

const OUTCOME_MESSAGES: Record<string, string> = {
  plan_complete: 'Plan is ready for review. Go to task to review and approve.',
  pr_ready: 'PR has been created.',
  needs_info: 'Agent needs more information.',
  failed: 'Agent run failed. Go to task for recovery options.',
};

export function AgentRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();

  // --- Agent run polling ---
  const { data: run, loading, error, refetch } = useIpc<AgentRun | null>(
    () => window.api.agents.get(runId!),
    [runId]
  );

  // --- Task polling (for live subtask updates) ---
  const { data: task, refetch: refetchTask } = useIpc<Task | null>(
    () => run?.taskId ? window.api.tasks.get(run.taskId) : Promise.resolve(null),
    [run?.taskId]
  );

  // --- Streaming output ---
  const [streamOutput, setStreamOutput] = useState('');
  const initializedFromDb = useRef(false);

  useEffect(() => {
    if (!run || initializedFromDb.current) return;
    if (run.status === 'running' && run.output) {
      setStreamOutput(run.output);
    }
    initializedFromDb.current = true;
  }, [run]);

  useEffect(() => {
    if (!run) return;
    const unsubscribe = window.api.on.agentOutput((taskId: string, chunk: string) => {
      if (taskId === run.taskId) {
        setStreamOutput((prev) => prev + chunk);
      }
    });
    return () => { unsubscribe(); };
  }, [run?.taskId]);

  // --- Poll agent run (2s while running) ---
  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const id = setInterval(refetch, 2000);
    return () => clearInterval(id);
  }, [run?.status, refetch]);

  // --- Poll task (3s while running) ---
  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const id = setInterval(refetchTask, 3000);
    return () => clearInterval(id);
  }, [run?.status, refetchTask]);

  // --- Git diff/stat polling (10s while running) ---
  const [gitDiff, setGitDiff] = useState<string | null>(null);
  const [gitStat, setGitStat] = useState<string | null>(null);
  const [gitLoading, setGitLoading] = useState(false);

  const fetchGit = useCallback(async () => {
    if (!run?.taskId) return;
    setGitLoading(true);
    try {
      const [d, s] = await Promise.all([
        window.api.git.diff(run.taskId),
        window.api.git.stat(run.taskId),
      ]);
      setGitDiff(d);
      setGitStat(s);
    } catch {
      // worktree may not exist yet
    } finally {
      setGitLoading(false);
    }
  }, [run?.taskId]);

  useEffect(() => {
    if (!run?.taskId) return;
    fetchGit();
  }, [run?.taskId, fetchGit]);

  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const id = setInterval(fetchGit, 10000);
    return () => clearInterval(id);
  }, [run?.status, fetchGit]);

  // --- Tab state ---
  const [activeTab, setActiveTab] = useState('subtasks');

  // --- Actions ---
  const [restarting, setRestarting] = useState(false);

  const handleStop = async () => {
    if (!runId) return;
    await window.api.agents.stop(runId);
    await refetch();
  };

  const handleRestart = async () => {
    if (!run) return;
    setRestarting(true);
    try {
      const newRun = await window.api.agents.start(run.taskId, run.mode, run.agentType);
      navigate(`/agents/${newRun.id}`, { replace: true });
    } finally {
      setRestarting(false);
    }
  };

  // --- Loading / error states (only on initial load, not during refetches) ---
  if (loading && !run) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading agent run...</p>
      </div>
    );
  }

  if (!loading && (error || !run)) {
    return (
      <div className="p-8">
        <p className="text-destructive">{error || 'Agent run not found'}</p>
      </div>
    );
  }

  if (!run) return null;

  const isRunning = run.status === 'running';
  const displayOutput = isRunning ? streamOutput : (run.output || streamOutput);
  const outcomeMessage = run.outcome ? OUTCOME_MESSAGES[run.outcome] : null;
  const subtasks = task?.subtasks ?? [];
  const doneCount = subtasks.filter((s) => s.status === 'done').length;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-6 py-3 border-b flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (task) {
              navigate(`/tasks/${task.id}`);
            } else {
              navigate(-1 as any);
            }
          }}
        >
          &larr; Back
        </Button>
        <Badge variant={run.status === 'completed' ? 'success' : isRunning ? 'default' : 'destructive'}>
          {run.status}
        </Badge>
        <h1 className="text-lg font-semibold truncate">
          {task ? task.title : 'Agent Run'}
        </h1>
        <span className="text-sm text-muted-foreground">{run.mode} / {run.agentType}</span>
        <div className="ml-auto flex gap-2">
          {isRunning && (
            <Button variant="destructive" size="sm" onClick={handleStop}>Stop</Button>
          )}
          {!isRunning && (
            <Button size="sm" onClick={handleRestart} disabled={restarting}>
              {restarting ? 'Restarting...' : 'Restart'}
            </Button>
          )}
        </div>
      </div>

      {/* Metadata row */}
      <div className="px-6 py-2 border-b flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
        {run.completedAt && <span>Completed: {new Date(run.completedAt).toLocaleString()}</span>}
        {run.outcome && <span>Outcome: <Badge variant="outline" className="text-xs ml-1">{run.outcome}</Badge></span>}
        {(run.costInputTokens != null || run.costOutputTokens != null) && (
          <span>Tokens: {(run.costInputTokens ?? 0).toLocaleString()} in / {(run.costOutputTokens ?? 0).toLocaleString()} out</span>
        )}
      </div>

      {/* Outcome banner */}
      {!isRunning && outcomeMessage && (
        <div className="mx-6 mt-2 rounded-md border px-4 py-2 flex items-center gap-3">
          <span className="text-sm">{outcomeMessage}</span>
          {task && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/tasks/${task.id}`)}>
              Go to Task
            </Button>
          )}
        </div>
      )}

      {/* Output panel (~60%) */}
      <div className="flex-[3] min-h-0 px-6 pt-3 pb-1 flex flex-col">
        <OutputPanel
          output={displayOutput}
          startedAt={run.startedAt}
          isRunning={isRunning}
        />
      </div>

      {/* Tabs panel (~40%) */}
      <div className="flex-[2] min-h-0 px-6 pb-3 flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
          <TabsList>
            <TabsTrigger value="subtasks">
              Subtasks{subtasks.length > 0 && ` (${doneCount}/${subtasks.length})`}
            </TabsTrigger>
            <TabsTrigger value="git">Git Changes</TabsTrigger>
            <TabsTrigger value="info">Task Info</TabsTrigger>
          </TabsList>

          <TabsContent value="subtasks" className="flex-1 overflow-auto border rounded-md">
            <SubtasksPanel subtasks={subtasks} />
          </TabsContent>

          <TabsContent value="git" className="flex-1 overflow-auto border rounded-md">
            <GitChangesPanel
              diff={gitDiff}
              stat={gitStat}
              onRefresh={fetchGit}
              loading={gitLoading}
            />
          </TabsContent>

          <TabsContent value="info" className="flex-1 overflow-auto border rounded-md">
            {task ? (
              <TaskInfoPanel task={task} run={run} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Loading task info...</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
