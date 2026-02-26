import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { LayoutDashboard, FolderOpen, CheckSquare, Layers, Workflow, Bot, Palette, GitBranch, Settings, Bug, SlidersHorizontal, MessageSquare, DollarSign, Trello, RefreshCw } from 'lucide-react';
import { ActiveAgentsEntries } from './ActiveAgentsList';
import { useActiveAgentRuns } from '../../hooks/useActiveAgentRuns';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { SidebarSection } from './SidebarSection';
import { SidebarSessions } from './SidebarSessions';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderOpen, label: 'Projects' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { to: '/kanban', icon: Trello, label: 'Kanban' },
  { to: '/features', icon: Layers, label: 'Features' },
  { to: '/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/cost', icon: DollarSign, label: 'Cost' },
  { to: '/source-control', icon: GitBranch, label: 'Source Control' },
  { to: '/pipelines', icon: Workflow, label: 'Pipelines' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/theme', icon: Palette, label: 'Theme' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

interface SidebarProps {
  onReportBug: () => void;
}

export function Sidebar({ onReportBug }: SidebarProps) {
  const { currentProjectId } = useCurrentProject();
  const { entries, refresh } = useActiveAgentRuns();
  const activeCount = entries.filter((e) => e.run.status === 'running').length;

  const refreshButton = entries.length > 0 ? (
    <button
      onClick={refresh}
      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      title="Refresh"
    >
      <RefreshCw className="h-3 w-3" />
    </button>
  ) : null;

  return (
    <aside className="w-56 border-r border-border bg-card flex flex-col">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 border-b border-border">
        <div className="flex items-center">
          <LayoutDashboard className="h-5 w-5 text-blue-500 mr-2" />
          <span className="font-semibold text-sm">Agents Manager</span>
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Pages */}
        <SidebarSection title="Pages" storageKey="pages">
          <nav className="px-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium mb-0.5 transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
            {currentProjectId && (
              <NavLink
                to={`/projects/${currentProjectId}/config`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium mb-0.5 transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
              >
                <SlidersHorizontal className="h-4 w-4" />
                Configuration
              </NavLink>
            )}
          </nav>
        </SidebarSection>

        {/* Sessions */}
        <SidebarSessions />

        {/* Active Agents */}
        <SidebarSection
          title={`Active Agents${activeCount > 0 ? ` (${activeCount})` : ''}`}
          storageKey="activeAgents"
          trailing={refreshButton}
        >
          {entries.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No active agents</p>
          ) : (
            <ActiveAgentsEntries entries={entries} refresh={refresh} />
          )}
        </SidebarSection>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <button
          onClick={onReportBug}
          className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Bug className="h-4 w-4" />
          Report Bug
        </button>
        <p className="text-xs text-muted-foreground mt-2 px-3">Agents Manager v1.0.0</p>
      </div>
    </aside>
  );
}
