import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { InlineError } from '../components/InlineError';
import { reportError } from '../lib/error-handler';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { OutputPanel } from '../components/agent-run/OutputPanel';
import type { OutputMode } from '../components/agent-run/OutputToolbar';
import { PromptPanel } from '../components/agent-run/PromptPanel';
import { JSONOutputPanel } from '../components/agent-run/JSONOutputPanel';
import { AgentRunCostPanel } from '../components/agent-run/AgentRunCostPanel';
import { AgentRunErrorBanner } from '../components/agent-run/AgentRunErrorBanner';
import { DebugLogsPanel } from '../components/agent-run/DebugLogsPanel';
import { ContextSidebar } from '../components/chat/ContextSidebar';
import type { AgentRun, AutomatedAgent, AgentChatMessage } from '../../shared/types';
import { messagesToRawText } from '../../shared/agent-message-utils';
import { useLocalStorage } from '../hooks/useLocalStorage';

export function AutomatedAgentRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();

  // --- Agent run polling ---
  const { data: run, loading, error, refetch } = useIpc<AgentRun | null>(
    () => window.api.agents.get(runId!),
    [runId]
  );

  // --- Fetch automated agent definition ---
  const { data: automatedAgent } = useIpc<AutomatedAgent | null>(
    () => run?.automatedAgentId
      ? window.api.automatedAgents.get(run.automatedAgentId)
      : Promise.resolve(null),
    [run?.automatedAgentId]
  );

  // --- Streaming messages ---
  const [streamMessages, setStreamMessages] = useState<AgentChatMessage[]>([]);

  useEffect(() => {
    if (!run) return;

    if (run.status === 'running' && run.messages && run.messages.length > 0) {
      setStreamMessages(run.messages);
    } else {
      setStreamMessages([]);
    }

    const unsubMessage = window.api.on.agentMessage((tid: string, msg: AgentChatMessage) => {
      if (tid === run.taskId) {
        setStreamMessages((prev) => [...prev, msg]);
      }
    });
    return () => { unsubMessage(); };
  }, [run?.taskId, run?.status]);

  // --- Poll agent run (2s while running) ---
  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const id = setInterval(refetch, 2000);
    return () => clearInterval(id);
  }, [run?.status, refetch]);

  // --- Subscribe to status changes for refetch ---
  useEffect(() => {
    if (!run?.taskId) return;
    const unsub = window.api?.on?.agentStatus?.((tid: string) => {
      if (tid === run.taskId) {
        refetch();
      }
    });
    return () => { unsub?.(); };
  }, [run?.taskId, refetch]);

  // --- Tab state ---
  const [activeTab, setActiveTab] = useLocalStorage('autoAgentRun.activeTab', 'output');

  // --- Section visibility ---
  const [metadataCollapsed, setMetadataCollapsed] = useLocalStorage('autoAgentRun.metadataCollapsed', false);

  // --- Sidebar toggle ---
  const [showSidebar, setShowSidebar] = useLocalStorage('autoAgentRun.showSidebar', true);

  // --- Output mode (raw vs rendered) ---
  const [outputMode, setOutputMode] = useLocalStorage<OutputMode>('autoAgentRun.outputMode', 'raw');

  // --- Actions ---
  const [restarting, setRestarting] = useState(false);

  const handleStop = async () => {
    if (!runId) return;
    try {
      await window.api.agents.stop(runId);
      await refetch();
    } catch (err) {
      reportError(err, 'Stop automated agent');
    }
  };

  const handleRestart = async () => {
    if (!run?.automatedAgentId) return;
    setRestarting(true);
    try {
      await window.api.automatedAgents.trigger(run.automatedAgentId);
      navigate('/automated-agents');
    } catch (err) {
      reportError(err, 'Restart automated agent');
    } finally {
      setRestarting(false);
    }
  };

  // --- Loading / error states ---
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
        <InlineError message={error || 'Agent run not found'} context="Automated agent run" />
      </div>
    );
  }

  if (!run) return null;

  const isRunning = run.status === 'running';
  const displayMessages = isRunning ? streamMessages : (run?.messages ?? streamMessages);
  const displayOutput = displayMessages.length > 0 ? messagesToRawText(displayMessages) : (run.output || '');
  const agentName = automatedAgent?.name || 'Automated Agent';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3 border-b flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/automated-agents')}
        >
          &larr; Back
        </Button>
        <Badge variant={run.status === 'completed' ? 'success' : isRunning ? 'default' : 'destructive'}>
          {run.status}
        </Badge>
        <h1 className="text-lg font-semibold truncate">
          {agentName}
        </h1>
        <span className="text-sm text-muted-foreground">{run.mode} / {run.agentType}</span>
        <div className="ml-auto flex gap-2">
          {(isRunning || run.costInputTokens || run.costOutputTokens) && (
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
        <AgentRunErrorBanner error={run.error} />
      )}

      {/* Main content — tabs + optional sidebar */}
      <div className="flex flex-1 min-h-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 px-6 pt-3">
          <TabsList>
            <TabsTrigger value="output">
              Output
              {isRunning && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500 inline-block animate-pulse" />}
            </TabsTrigger>
            <TabsTrigger value="prompt">Prompt</TabsTrigger>
            <TabsTrigger value="cost">Cost</TabsTrigger>
            <TabsTrigger value="debug-logs">Debug Logs</TabsTrigger>
            <TabsTrigger value="json">JSON Output</TabsTrigger>
          </TabsList>

          <TabsContent value="output" className="flex-1 min-h-0 flex flex-col pb-3">
            <OutputPanel
              output={displayOutput}
              messages={displayMessages}
              startedAt={run.startedAt}
              isRunning={isRunning}
              timeoutMs={run.timeoutMs}
              maxTurns={run.maxTurns}
              messageCount={run.messageCount}
              outputMode={outputMode}
              onOutputModeChange={setOutputMode}
            />
          </TabsContent>

          <TabsContent value="prompt" className="flex-1 min-h-0 flex flex-col border rounded-md overflow-hidden pb-3">
            <PromptPanel prompt={run.prompt} />
          </TabsContent>

          <TabsContent value="cost" className="flex-1 min-h-0 overflow-auto border rounded-md pb-3">
            <AgentRunCostPanel run={run} />
          </TabsContent>

          <TabsContent value="debug-logs" className="flex-1 min-h-0 flex flex-col border rounded-md overflow-hidden pb-3">
            <DebugLogsPanel run={run} />
          </TabsContent>

          <TabsContent value="json" className="flex-1 min-h-0 flex flex-col border rounded-md overflow-hidden pb-3">
            <JSONOutputPanel
              payload={run.payload}
              isRunning={isRunning}
            />
          </TabsContent>
        </Tabs>

        {/* Token usage sidebar */}
        {showSidebar && (isRunning || run.costInputTokens || run.costOutputTokens) && (
          <ContextSidebar messages={displayMessages} run={run} />
        )}
      </div>
    </div>
  );
}
