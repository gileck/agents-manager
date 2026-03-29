import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, TerminalSquare, X, CircleDot } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SidebarSection } from './SidebarSection';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useTerminals } from '../../hooks/useTerminals';
import { reportError } from '../../lib/error-handler';

export function SidebarTerminals() {
  const { currentProjectId, currentProject } = useCurrentProject();
  const { terminals, currentTerminalId, createTerminal, closeTerminal, switchTerminal } = useTerminals();
  const navigate = useNavigate();
  const location = useLocation();
  const onTerminalPage = location.pathname.startsWith('/terminal');

  const handleCreate = async () => {
    if (!currentProjectId || !currentProject) return;
    if (!currentProject.path) {
      reportError(new Error('Project path not set — configure it in project settings'), 'Create terminal');
      return;
    }
    const num = terminals.length + 1;
    const session = await createTerminal(currentProjectId, `Terminal ${num}`, currentProject.path);
    if (session) {
      navigate(`/terminal/${session.id}`);
    }
  };

  const handleClick = (terminalId: string) => {
    switchTerminal(terminalId);
    navigate(`/terminal/${terminalId}`);
  };

  const handleClose = async (e: React.MouseEvent, terminalId: string) => {
    e.stopPropagation();
    await closeTerminal(terminalId);
  };

  const headerButtons = (
    <button
      onClick={handleCreate}
      className="p-1 rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
      title="New terminal"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  );

  if (!currentProjectId) {
    return (
      <SidebarSection title="Terminals" storageKey="terminals" trailing={null}>
        <p className="px-3 py-2 text-xs text-muted-foreground">No project selected</p>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection title="Terminals" storageKey="terminals" trailing={headerButtons}>
      {terminals.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No terminals</p>
      ) : (
        <div className="px-1">
          {terminals.map((terminal) => {
            const isActive = onTerminalPage && terminal.id === currentTerminalId;
            const isRunning = terminal.status === 'running';

            return (
              <div
                key={terminal.id}
                onClick={() => handleClick(terminal.id)}
                className={cn(
                  'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer transition-colors mb-1 border border-transparent',
                  isActive
                    ? 'bg-accent/80 text-foreground border-border/55'
                    : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
                )}
              >
                <TerminalSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-xs font-medium">
                  {terminal.name}
                </span>
                {isRunning && (
                  <CircleDot className="h-3 w-3 text-green-500 shrink-0" />
                )}
                <button
                  onClick={(e) => handleClose(e, terminal.id)}
                  className={cn(
                    'p-0.5 rounded hover:bg-accent transition-opacity shrink-0',
                    'opacity-0 group-hover:opacity-100',
                    isActive && 'hover:bg-primary-foreground/20'
                  )}
                  title="Close terminal"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </SidebarSection>
  );
}
