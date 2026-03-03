import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Pencil, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { reportError } from '../lib/error-handler';
import { InlineError } from '../components/InlineError';
import { MarkdownContent } from '../components/chat/MarkdownContent';
import { ScheduleDisplay } from '../components/automated-agents/ScheduleDisplay';
import { AutomatedAgentDialog } from '../components/automated-agents/AutomatedAgentDialog';
import type { AutomatedAgent, AgentRun } from '../../shared/types';

export function AutomatedAgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: agent, loading, error, refetch: refetchAgent } = useIpc<AutomatedAgent | null>(
    () => window.api.automatedAgents.get(id!),
    [id],
  );

  const { data: runs, error: runsError, refetch: refetchRuns } = useIpc<AgentRun[]>(
    () => window.api.automatedAgents.getRuns(id!),
    [id],
  );

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const runList = useMemo(() => runs ?? [], [runs]);
  const selectedRun = selectedRunId
    ? runList.find((r) => r.id === selectedRunId) ?? null
    : runList[0] ?? null;

  // Auto-select latest run when runs load
  useEffect(() => {
    if (runList.length > 0 && !selectedRunId) {
      setSelectedRunId(runList[0].id);
    }
  }, [runList, selectedRunId]);

  // Poll while any run is active
  const hasActiveRun = runList.some((r) => r.status === 'running');
  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = setInterval(() => {
      refetchAgent();
      refetchRuns();
    }, 5000);
    return () => clearInterval(interval);
  }, [hasActiveRun, refetchAgent, refetchRuns]);

  // Subscribe to real-time agent status updates
  useEffect(() => {
    const unsub = window.api?.on?.agentStatus?.((taskId: string) => {
      if (taskId === `__auto__:${id}`) {
        refetchAgent();
        refetchRuns();
      }
    });
    return () => { unsub?.(); };
  }, [id, refetchAgent, refetchRuns]);

  const handleTrigger = useCallback(async () => {
    if (!agent) return;
    setTriggering(true);
    try {
      await window.api.automatedAgents.trigger(agent.id);
      toast.success(`Agent "${agent.name}" triggered`);
      refetchAgent();
      refetchRuns();
    } catch (err) {
      reportError(err, 'Trigger automated agent');
    } finally {
      setTriggering(false);
    }
  }, [agent, refetchAgent, refetchRuns]);

  const handleToggleEnabled = useCallback(async () => {
    if (!agent) return;
    setToggling(true);
    try {
      await window.api.automatedAgents.update(agent.id, { enabled: !agent.enabled });
      refetchAgent();
    } catch (err) {
      reportError(err, 'Toggle automated agent');
    } finally {
      setToggling(false);
    }
  }, [agent, refetchAgent]);

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-6"><InlineError message={error} context="Automated agent" /></div>;
  if (!agent) return <div className="p-6 text-muted-foreground">Agent not found</div>;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/automated-agents')}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-semibold">{agent.name}</h1>
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
            agent.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-muted text-muted-foreground'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${agent.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
            {agent.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <button
          onClick={handleToggleEnabled}
          disabled={toggling}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            agent.enabled ? 'bg-primary' : 'bg-muted'
          }`}
          title={agent.enabled ? 'Disable' : 'Enable'}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            agent.enabled ? 'translate-x-4' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {/* Two-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main column */}
        <div className="flex-1 overflow-y-auto p-6">
          {agent.description && (
            <p className="text-sm text-muted-foreground mb-4">{agent.description}</p>
          )}

          {/* Run output */}
          <div className="border border-border rounded-lg bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-medium">
                {selectedRun ? (
                  <>
                    Run Output
                    <span className="ml-2 text-xs text-muted-foreground font-normal">
                      {new Date(selectedRun.startedAt).toLocaleString()}
                      {selectedRun.status === 'running' && (
                        <span className="ml-1.5 text-blue-500 animate-pulse">running...</span>
                      )}
                    </span>
                  </>
                ) : (
                  'Run Output'
                )}
              </h2>
              {selectedRun && (
                <button
                  onClick={() => navigate(`/automated-agents/runs/${selectedRun.id}`)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="Open full run view"
                >
                  <ExternalLink className="h-3 w-3" />
                  Full view
                </button>
              )}
            </div>
            <div className="p-4">
              {runsError ? (
                <InlineError message={runsError} context="Load agent runs" />
              ) : selectedRun?.output ? (
                <div className="text-sm">
                  <MarkdownContent content={selectedRun.output} />
                </div>
              ) : selectedRun?.error ? (
                <div className="text-sm text-red-500">
                  <p className="font-medium mb-1">Error</p>
                  <pre className="bg-muted rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap">{selectedRun.error}</pre>
                </div>
              ) : selectedRun?.status === 'running' ? (
                <p className="text-sm text-muted-foreground animate-pulse">Agent is running...</p>
              ) : runList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs yet. Click "Run Now" to execute this agent.</p>
              ) : (
                <p className="text-sm text-muted-foreground">No output available for this run.</p>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar column */}
        <div className="w-72 border-l border-border overflow-y-auto shrink-0">
          {/* Actions */}
          <div className="p-4 border-b border-border">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Actions</h3>
            <div className="flex gap-2">
              <button
                onClick={handleTrigger}
                disabled={triggering}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                <Play className="h-3 w-3" />
                {triggering ? 'Running...' : 'Run Now'}
              </button>
              <button
                onClick={() => setEditDialogOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            </div>
          </div>

          {/* Run History */}
          <div className="p-4 border-b border-border">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Run History</h3>
            {runList.length === 0 ? (
              <p className="text-xs text-muted-foreground">No runs yet</p>
            ) : (
              <div className="space-y-1">
                {runList.slice(0, 20).map((run) => {
                  const duration = run.completedAt ? Math.round((run.completedAt - run.startedAt) / 1000) : null;
                  const isSelected = run.id === (selectedRun?.id ?? null);
                  return (
                    <button
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors text-left ${
                        isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                          run.status === 'completed' ? 'bg-green-500' :
                          run.status === 'failed' ? 'bg-red-500' :
                          run.status === 'running' ? 'bg-blue-500 animate-pulse' :
                          'bg-gray-400'
                        }`} />
                        <span className="truncate">
                          {new Date(run.startedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-1">
                        {duration !== null && <span>{duration}s</span>}
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/automated-agents/runs/${run.id}`); }}
                          className="p-0.5 rounded hover:bg-muted"
                          title="Open full run view"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="p-4 border-b border-border">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Schedule</h3>
            <ScheduleDisplay schedule={agent.schedule} />
            {agent.nextRunAt && agent.enabled && (
              <p className="text-xs text-muted-foreground mt-1">
                Next: {new Date(agent.nextRunAt).toLocaleString()}
              </p>
            )}
          </div>

          {/* Capabilities */}
          <div className="p-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Capabilities</h3>
            <div className="flex flex-wrap gap-1">
              {agent.capabilities.readOnly && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">Read-only</span>}
              {agent.capabilities.canCreateTasks && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Create tasks</span>}
              {agent.capabilities.canModifyTasks && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">Modify tasks</span>}
              {agent.capabilities.dryRun && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">Dry run</span>}
              {!agent.capabilities.readOnly && !agent.capabilities.canCreateTasks && !agent.capabilities.canModifyTasks && !agent.capabilities.dryRun && (
                <span className="text-xs text-muted-foreground">None configured</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit dialog */}
      {editDialogOpen && (
        <AutomatedAgentDialog
          projectId={agent.projectId}
          agent={agent}
          onClose={() => setEditDialogOpen(false)}
          onSaved={() => { setEditDialogOpen(false); refetchAgent(); }}
        />
      )}
    </div>
  );
}
