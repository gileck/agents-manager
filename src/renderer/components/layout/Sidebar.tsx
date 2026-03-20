import React, { useCallback, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  Bug,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  SquarePen,
  Settings,
} from 'lucide-react';
import { ActiveAgentsEntries } from './ActiveAgentsList';
import { useActiveAgentRuns } from '../../hooks/useActiveAgentRuns';
import { SidebarSection } from './SidebarSection';
import { SidebarSessions } from './SidebarSessions';
import { SidebarAutomatedAgents } from './SidebarAutomatedAgents';
import { SidebarRecentTasks } from './SidebarRecentTasks';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { reportError } from '../../lib/error-handler';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { SIDEBAR_NAV_PAGES } from '../../lib/pages';

const COLLAPSED_WIDTH = 52;
const MIN_WIDTH = 180;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 288;

interface SidebarProps {
  onReportBug: () => void;
}

export function Sidebar({ onReportBug }: SidebarProps) {
  const { entries, refresh } = useActiveAgentRuns();
  const { currentProjectId } = useCurrentProject();
  const { sessions, createSession } = useProjectChatSessions();
  const navigate = useNavigate();
  const activeCount = entries.filter((e) => e.run.status === 'running').length;

  const [isCollapsed, setIsCollapsed] = useLocalStorage<boolean>('sidebar.collapsed', false);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage<number>('sidebar.width', DEFAULT_WIDTH);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (isCollapsed) return;
      e.preventDefault();
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = sidebarWidth;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = moveEvent.clientX - dragStartX.current;
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [isCollapsed, sidebarWidth, setSidebarWidth]
  );

  // Restore body styles on unmount in case a drag was in progress
  useEffect(() => {
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  const handleNewThread = async () => {
    if (!currentProjectId) { navigate('/chat'); return; }

    try {
      const maxNum = sessions.reduce((max, s) => {
        const match = s.name.match(/^Session (\d+)$/);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0);
      const newSession = await createSession(`Session ${maxNum + 1}`);
      navigate(newSession?.id ? `/chat/${newSession.id}` : '/chat');
    } catch (err) {
      reportError(err, 'Create session');
      navigate('/chat');
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

  const currentWidth = isCollapsed ? COLLAPSED_WIDTH : sidebarWidth;

  return (
    <aside
      className="border-r border-border/70 bg-card/50 backdrop-blur-md flex flex-col relative shrink-0"
      style={{
        width: currentWidth,
        transition: 'width 200ms ease',
        overflow: 'hidden',
      }}
    >
      {/* Header: Agents Manager badge + collapse toggle */}
      <div className={cn('pt-4 pb-3 border-b border-border/60', isCollapsed ? 'px-1' : 'px-4')}>
        <div className={cn('flex items-center', isCollapsed ? 'justify-center' : 'justify-between')}>
          {!isCollapsed && (
            <div className="inline-flex items-center rounded-full border border-border/75 bg-muted/45 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Agents Manager
            </div>
          )}
          <button
            onClick={() => setIsCollapsed((c: boolean) => !c)}
            className="p-1 rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed
              ? <ChevronRight className="h-4 w-4" />
              : <ChevronLeft className="h-4 w-4" />
            }
          </button>
        </div>

        <nav className="mt-3 grid gap-1">
          <button
            onClick={handleNewThread}
            className={cn(
              'flex items-center rounded-lg py-2 text-sm font-medium transition-colors text-left',
              isCollapsed
                ? 'justify-center px-1'
                : 'gap-2 px-2.5',
              'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
            )}
            title="New thread"
          >
            <SquarePen className="h-4 w-4 shrink-0" />
            {!isCollapsed && 'New thread'}
          </button>
          {SIDEBAR_NAV_PAGES.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={isCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center rounded-lg py-2 text-sm font-medium transition-colors',
                  isCollapsed ? 'justify-center px-1' : 'gap-2 px-2.5',
                  isActive
                    ? 'bg-accent/85 text-foreground border border-border/60'
                    : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!isCollapsed && item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Scrollable sections — hidden in collapsed mode */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
          <SidebarSessions />
          <SidebarRecentTasks runningTaskIds={new Set(entries.filter(e => e.run.status === 'running').map(e => e.run.taskId))} />
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
      )}

      {/* Spacer to push footer to the bottom in collapsed mode */}
      {isCollapsed && <div className="flex-1" />}

      {/* Footer */}
      <div className={cn('border-t border-border/60 space-y-1', isCollapsed ? 'p-1' : 'p-3')}>
        <NavLink
          to="/settings"
          title={isCollapsed ? 'Settings' : undefined}
          className={({ isActive }) =>
            cn(
              'flex items-center w-full rounded-lg py-2 text-sm font-medium transition-colors',
              isCollapsed ? 'justify-center px-1' : 'gap-2 px-3',
              isActive
                ? 'bg-accent/85 text-foreground border border-border/60'
                : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
            )
          }
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!isCollapsed && 'Settings'}
        </NavLink>
        <button
          onClick={onReportBug}
          className={cn(
            'flex items-center w-full rounded-lg py-2 text-sm font-medium text-muted-foreground hover:bg-accent/55 hover:text-foreground transition-colors',
            isCollapsed ? 'justify-center px-1' : 'gap-2 px-3'
          )}
          title={isCollapsed ? 'Report Bug' : undefined}
        >
          <Bug className="h-4 w-4 shrink-0" />
          {!isCollapsed && 'Report Bug'}
        </button>
        {!isCollapsed && (
          <p className="text-[11px] text-muted-foreground px-3 pt-1">Agents Manager v1.0.0</p>
        )}
      </div>

      {/* Drag-resize handle — only visible when expanded */}
      {!isCollapsed && (
        <div
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-border/60 active:bg-primary/30 transition-colors z-20"
          onMouseDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}
    </aside>
  );
}
