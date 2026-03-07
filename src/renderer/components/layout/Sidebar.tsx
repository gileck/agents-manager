import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  Bot,
  Bug,
  CheckSquare,
  FolderOpen,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings,
  Trello,
} from 'lucide-react';
import { ActiveAgentsEntries } from './ActiveAgentsList';
import { useActiveAgentRuns } from '../../hooks/useActiveAgentRuns';
import { SidebarSection } from './SidebarSection';
import { SidebarSessions } from './SidebarSessions';
import { SidebarAutomatedAgents } from './SidebarAutomatedAgents';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { reportError } from '../../lib/error-handler';

const navItems = [
  { to: '/chat', icon: MessageSquare, label: 'New thread' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { to: '/kanban', icon: Trello, label: 'Kanban' },
  { to: '/projects', icon: FolderOpen, label: 'Projects' },
  { to: '/automated-agents', icon: Bot, label: 'Automations' },
];

interface SidebarProps {
  onReportBug: () => void;
}

export function Sidebar({ onReportBug }: SidebarProps) {
  const { entries, refresh } = useActiveAgentRuns();
  const { currentProjectId } = useCurrentProject();
  const { sessions, createSession } = useProjectChatSessions();
  const navigate = useNavigate();
  const activeCount = entries.filter((e) => e.run.status === 'running').length;

  const handleNewThread = async () => {
    navigate('/chat');
    if (!currentProjectId) return;

    try {
      const maxNum = sessions.reduce((max, s) => {
        const match = s.name.match(/^Session (\d+)$/);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0);
      await createSession(`Session ${maxNum + 1}`);
    } catch (err) {
      reportError(err, 'Create session');
    }
  };

  const refreshButton = entries.length > 0 ? (
    <button
      onClick={refresh}
      className="p-1 rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
      title="Refresh"
    >
      <RefreshCw className="h-3.5 w-3.5" />
    </button>
  ) : null;

  return (
    <aside className="w-72 border-r border-border/70 bg-card/50 backdrop-blur-md flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-border/60">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center rounded-full border border-border/75 bg-muted/45 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            Agents Manager
          </div>
          <button
            onClick={handleNewThread}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-[0_8px_18px_hsl(var(--primary)/0.3)] hover:bg-primary/90 transition-colors"
            title="New thread"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>

        <nav className="mt-3 grid gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent/85 text-foreground border border-border/60'
                    : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
        <SidebarSessions />
        <SidebarAutomatedAgents />
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

      <div className="p-3 border-t border-border/60 space-y-1">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent/85 text-foreground border border-border/60'
                : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
            )
          }
        >
          <Settings className="h-4 w-4" />
          Settings
        </NavLink>
        <button
          onClick={onReportBug}
          className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent/55 hover:text-foreground transition-colors"
        >
          <Bug className="h-4 w-4" />
          Report Bug
        </button>
        <p className="text-[11px] text-muted-foreground px-3 pt-1">Agents Manager v1.0.0</p>
      </div>
    </aside>
  );
}
