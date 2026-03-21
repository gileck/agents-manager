import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, CheckCircle2, X, Clock, MessageCircleQuestion } from 'lucide-react';
import { RunningAgent } from '../../../shared/types';
import { Button } from '../ui/button';

/** Real-time elapsed time display, updates every second. */
function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.floor((now - startedAt) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const hours = Math.floor(minutes / 60);
  const seconds = elapsed % 60;

  if (hours > 0) {
    return <>{hours}h {minutes % 60}m</>;
  }
  if (minutes > 0) {
    return <>{minutes}m {seconds}s</>;
  }
  return <>{seconds}s</>;
}

interface ActiveAgentsPanelProps {
  agents: RunningAgent[];
  onNavigateToSession: (sessionId: string) => void;
  onStopAgent: (sessionId: string) => void;
}

export function ActiveAgentsPanel({
  agents,
  onNavigateToSession,
  onStopAgent,
}: ActiveAgentsPanelProps) {
  // Group agents by project
  const agentsByProject = agents.reduce((acc, agent) => {
    if (!acc[agent.projectId]) {
      acc[agent.projectId] = {
        projectName: agent.projectName,
        agents: [],
      };
    }
    acc[agent.projectId].agents.push(agent);
    return acc;
  }, {} as Record<string, { projectName: string; agents: RunningAgent[] }>);

  const getStatusIcon = (status: RunningAgent['status']) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case 'waiting_for_input':
        return <MessageCircleQuestion className="h-4 w-4 text-amber-500" />;
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getRelativeTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (agents.length === 0) {
    return null;
  }

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        Active Agents
        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
          {agents.length}
        </span>
      </h3>

      <div className="space-y-1">
        {Object.entries(agentsByProject).map(([projectId, { projectName, agents: projectAgents }]) => (
          <div key={projectId}>
            <div className="py-1">
              <p className="text-xs font-medium text-muted-foreground">{projectName}</p>
            </div>

            {projectAgents.map((agent) => (
              <div
                key={agent.sessionId}
                className="px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors group"
                onClick={() => onNavigateToSession(agent.sessionId)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {getStatusIcon(agent.status)}
                      <span className="text-sm font-medium truncate">
                        {agent.sessionName}
                      </span>
                    </div>

                    {agent.messagePreview && (
                      <p className="text-xs text-muted-foreground truncate mb-0.5">
                        {agent.messagePreview}
                      </p>
                    )}

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {(agent.status === 'running' || agent.status === 'waiting_for_input')
                          ? <ElapsedTime startedAt={agent.startedAt} />
                          : getRelativeTime(agent.lastActivity)
                        }
                      </span>
                    </div>
                  </div>

                  {(agent.status === 'running' || agent.status === 'waiting_for_input') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStopAgent(agent.sessionId);
                      }}
                      title="Stop agent"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}