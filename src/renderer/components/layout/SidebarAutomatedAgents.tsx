import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useAutomatedAgents } from '../../hooks/useAutomatedAgents';
import { SidebarSection } from './SidebarSection';

export function SidebarAutomatedAgents() {
  const { currentProjectId } = useCurrentProject();
  const { agents, error } = useAutomatedAgents(currentProjectId ?? undefined);
  const location = useLocation();

  if (!currentProjectId) return null;
  if (agents.length === 0 && !error) return null;

  return (
    <SidebarSection title="Automated Agents" storageKey="automatedAgents">
      {error ? (
        <p className="px-3 py-2 text-xs text-red-500" title={error}>Failed to load agents</p>
      ) : (
      <div className="px-2">
        {agents.map((agent) => {
          const isActive = location.pathname === `/automated-agents/${agent.id}`;
          return (
            <NavLink
              key={agent.id}
              to={`/automated-agents/${agent.id}`}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors mb-0.5',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                agent.lastRunStatus === 'completed' ? 'bg-green-500' :
                agent.lastRunStatus === 'failed' ? 'bg-red-500' :
                agent.lastRunStatus === 'running' ? 'bg-blue-500 animate-pulse' :
                'bg-gray-400'
              }`} />
              <span className="truncate">{agent.name}</span>
            </NavLink>
          );
        })}
      </div>
      )}
    </SidebarSection>
  );
}
