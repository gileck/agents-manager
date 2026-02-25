import React, { useState } from 'react';
import { ChevronRight, Loader2, AlertCircle, CheckCircle2, X, Clock } from 'lucide-react';
import { cn } from '@template/renderer/lib/utils';
import { RunningAgent } from '../../../shared/types';
import { Button } from '../ui/button';

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
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  const getElapsedTime = (startedAt: number) => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  if (agents.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'border-l border-border bg-card transition-all duration-300',
        isCollapsed ? 'w-12' : 'w-80'
      )}
    >
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className={cn(
            'text-sm font-semibold flex items-center gap-2',
            isCollapsed && 'hidden'
          )}>
            Active Agents
            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {agents.length}
            </span>
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform',
                isCollapsed && 'rotate-180'
              )}
            />
          </Button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="overflow-y-auto max-h-[calc(100vh-8rem)]">
          {Object.entries(agentsByProject).map(([projectId, { projectName, agents: projectAgents }]) => (
            <div key={projectId} className="border-b border-border last:border-0">
              <div className="px-3 py-2 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground">{projectName}</p>
              </div>

              {projectAgents.map((agent) => (
                <div
                  key={agent.sessionId}
                  className="px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors group"
                  onClick={() => onNavigateToSession(agent.sessionId)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(agent.status)}
                        <span className="text-sm font-medium truncate">
                          {agent.sessionName}
                        </span>
                      </div>

                      {agent.messagePreview && (
                        <p className="text-xs text-muted-foreground truncate mb-1">
                          {agent.messagePreview}
                        </p>
                      )}

                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {agent.status === 'running'
                            ? getElapsedTime(agent.startedAt)
                            : getRelativeTime(agent.lastActivity)
                          }
                        </span>
                      </div>
                    </div>

                    {agent.status === 'running' && (
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
      )}

      {isCollapsed && (
        <div className="flex flex-col items-center gap-2 py-3">
          {agents.filter(a => a.status === 'running').length > 0 && (
            <div className="relative">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="absolute -top-1 -right-1 text-xs bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">
                {agents.filter(a => a.status === 'running').length}
              </span>
            </div>
          )}
          {agents.filter(a => a.status === 'completed').length > 0 && (
            <div className="relative">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="absolute -top-1 -right-1 text-xs bg-green-500 text-white rounded-full w-4 h-4 flex items-center justify-center">
                {agents.filter(a => a.status === 'completed').length}
              </span>
            </div>
          )}
          {agents.filter(a => a.status === 'failed').length > 0 && (
            <div className="relative">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="absolute -top-1 -right-1 text-xs bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center">
                {agents.filter(a => a.status === 'failed').length}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}