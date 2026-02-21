import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { OutputPanel } from '../components/agent-run/OutputPanel';
import { PromptPanel } from '../components/agent-run/PromptPanel';
import { SubtasksPanel } from '../components/agent-run/SubtasksPanel';
import { GitChangesPanel } from '../components/agent-run/GitChangesPanel';
import { TaskInfoPanel } from '../components/agent-run/TaskInfoPanel';
import { JSONOutputPanel } from '../components/agent-run/JSONOutputPanel';
import { AgentRunCostPanel } from '../components/agent-run/AgentRunCostPanel';
import { ChatMessageList } from '../components/chat/ChatMessageList';
import { ChatInput } from '../components/chat/ChatInput';
import { ContextSidebar } from '../components/chat/ContextSidebar';
import { useAgentStream } from '../contexts/AgentStreamContext';
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

  // --- Agent stream context (for chat persistence across route changes) ---
  const { getMessages, addMessage, isActive } = useAgentStream();
  const taskId = run?.taskId;
  const messages = taskId ? getMessages(taskId) : [];
  const [isQueued, setIsQueued] = useState(false);

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
    const unsubscribe = window.api.on.agentOutput((tid: string, chunk: string) => {
      if (tid === run.taskId) {
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

  // --- Subscribe to status changes for refetch ---
  useEffect(() => {
    if (!taskId) return;
    const unsub = window.api?.on?.agentStatus?.((tid: string) => {
      if (tid === taskId) {
        refetch();
        setIsQueued(false);
      }
    });
    return () => { unsub?.(); };
  }, [taskId, refetch]);

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
  const [activeTab, setActiveTab] = useState('output');

  // --- Section visibility ---
  const [metadataCollapsed, setMetadataCollapsed] = useState(false);

  // --- Sidebar toggle ---
  const [showSidebar, setShowSidebar] = useState(false);

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

  const handleSendMessage = async (text: string) => {
    if (!taskId) return;
    addMessage(taskId, { type: 'user', text, timestamp: Date.now() });
    if (isRunning) {
      setIsQueued(true);
    }
    await window.api.agents.sendMessage(taskId, text);
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

  const isRunning = run.status === 'running' || (taskId ? isActive(taskId) : false);
  const displayOutput = isRunning ? streamOutput : (run.output || streamOutput);
  const outcomeMessage = run.outcome ? OUTCOME_MESSAGES[run.outcome] : null;
  const subtasks = task?.subtasks ?? [];
  const doneCount = subtasks.filter((s) => s.status === 'done').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3 border-b flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (task) {
              navigate(`/tasks/${task.id}`);
            } else {
              (navigate as (delta: number) => void)(-1);
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
          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSidebar(!showSidebar)}
              title="Toggle token usage sidebar"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 16V8m4 8v-5m4 5V5m4 11v-3" />
              </svg>
            </Button>
          )}
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

      {/* Metadata row — collapsible */}
      {!metadataCollapsed ? (
        <div className="px-6 py-2 border-b flex flex-wrap gap-4 text-xs text-muted-foreground">
          <button
            onClick={() => setMetadataCollapsed(true)}
            className="hover:text-foreground transition-colors"
            title="Collapse metadata"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
          {run.completedAt && <span>Completed: {new Date(run.completedAt).toLocaleString()}</span>}
          {run.outcome && <span>Outcome: <Badge variant="outline" className="text-xs ml-1">{run.outcome}</Badge></span>}
          {(run.costInputTokens != null || run.costOutputTokens != null) && (
            <span>Tokens: {(run.costInputTokens ?? 0).toLocaleString()} in / {(run.costOutputTokens ?? 0).toLocaleString()} out</span>
          )}
        </div>
      ) : (
        <div className="px-6 py-1 border-b">
          <button
            onClick={() => setMetadataCollapsed(false)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <ChevronRight className="h-3 w-3" />
            Metadata
          </button>
        </div>
      )}

      {/* Error alert */}
      {!isRunning && (run.status === 'failed' || run.status === 'timed_out') && run.error && (
        <div className="mx-6 mt-2 rounded-md px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5' }}>
          <svg className="h-5 w-5 flex-shrink-0" style={{ color: '#dc2626' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-sm font-medium" style={{ color: '#dc2626' }}>{run.error}</span>
        </div>
      )}

      {/* Outcome banner */}
      {!isRunning && outcomeMessage && !metadataCollapsed && (
        <div className="mx-6 mt-2 rounded-md border px-4 py-2 flex items-center gap-3">
          <span className="text-sm">{outcomeMessage}</span>
          {task && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/tasks/${task.id}`)}>
              Go to Task
            </Button>
          )}
        </div>
      )}

      {/* Main content — tabs + optional sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Main tabs — fill remaining space */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 px-6 pt-3">
          <TabsList>
            <TabsTrigger value="output">
              Output
              {isRunning && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500 inline-block animate-pulse" />}
            </TabsTrigger>
            {messages.length > 0 && (
              <TabsTrigger value="chat">
                Chat
                {isRunning && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-blue-500 inline-block animate-pulse" />}
              </TabsTrigger>
            )}
            <TabsTrigger value="prompt">Prompt</TabsTrigger>
            <TabsTrigger value="subtasks">
              Subtasks{subtasks.length > 0 && ` (${doneCount}/${subtasks.length})`}
            </TabsTrigger>
            <TabsTrigger value="git">Git</TabsTrigger>
            <TabsTrigger value="task">Task Details</TabsTrigger>
            <TabsTrigger value="cost">Cost</TabsTrigger>
            <TabsTrigger value="json">JSON Output</TabsTrigger>
          </TabsList>

          <TabsContent value="output" className="flex-1 min-h-0 flex flex-col pb-3">
            <OutputPanel
              output={displayOutput}
              startedAt={run.startedAt}
              isRunning={isRunning}
              timeoutMs={run.timeoutMs}
              maxTurns={run.maxTurns}
              messageCount={run.messageCount}
            />
          </TabsContent>

          {messages.length > 0 && (
            <TabsContent value="chat" className="flex-1 min-h-0 flex flex-col pb-3">
              <div className="flex-1 min-h-0 flex flex-col">
                <ChatMessageList messages={messages} isRunning={isRunning} />
                <ChatInput
                  onSend={handleSendMessage}
                  onStop={handleStop}
                  isRunning={isRunning}
                  isQueued={isQueued}
                />
              </div>
            </TabsContent>
          )}

          <TabsContent value="prompt" className="flex-1 min-h-0 flex flex-col border rounded-md overflow-hidden pb-3">
            <PromptPanel prompt={run.prompt} />
          </TabsContent>

          <TabsContent value="subtasks" className="flex-1 min-h-0 overflow-auto border rounded-md pb-3">
            <SubtasksPanel subtasks={subtasks} />
          </TabsContent>

          <TabsContent value="git" className="flex-1 min-h-0 overflow-auto border rounded-md pb-3">
            <GitChangesPanel
              diff={gitDiff}
              stat={gitStat}
              onRefresh={fetchGit}
              loading={gitLoading}
            />
          </TabsContent>

          <TabsContent value="task" className="flex-1 min-h-0 overflow-auto border rounded-md pb-3">
            {task ? (
              <TaskInfoPanel task={task} run={run} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Loading task info...</p>
            )}
          </TabsContent>

          <TabsContent value="cost" className="flex-1 min-h-0 overflow-auto border rounded-md pb-3">
            <AgentRunCostPanel run={run} />
          </TabsContent>

          <TabsContent value="json" className="flex-1 min-h-0 flex flex-col border rounded-md overflow-hidden pb-3">
            <JSONOutputPanel
              payload={run.payload}
              isRunning={isRunning}
            />
          </TabsContent>
        </Tabs>

        {/* Token usage sidebar */}
        {showSidebar && messages.length > 0 && (
          <ContextSidebar messages={messages} run={run} />
        )}
      </div>
    </div>
  );
}
