import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, TerminalSquare, X, CircleDot, Bot } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { SidebarSection } from './SidebarSection';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useTerminalsContext } from '../../contexts/TerminalsContext';
import { reportError } from '../../lib/error-handler';
import type { TerminalType } from '../../../shared/types';

export function SidebarTerminals() {
  const { currentProjectId, currentProject } = useCurrentProject();
  const { terminals, currentTerminalId, createTerminal, closeTerminal, renameTerminal, switchTerminal } = useTerminalsContext();
  const navigate = useNavigate();
  const location = useLocation();
  const onTerminalPage = location.pathname.startsWith('/terminal');

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  const handleCreate = async (type: TerminalType) => {
    setNewMenuOpen(false);
    if (!currentProjectId || !currentProject) return;
    if (!currentProject.path) {
      reportError(new Error('Project path not set — configure it in project settings'), 'Create terminal');
      return;
    }
    const num = terminals.length + 1;
    const name = type === 'claude' ? `Claude Code ${num}` : `Terminal ${num}`;
    const session = await createTerminal(currentProjectId, name, currentProject.path, type);
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

  const handleStartRename = (terminalId: string, currentName: string) => {
    setRenameId(terminalId);
    setRenameName(currentName);
  };

  const handleRename = () => {
    if (renameId && renameName.trim()) {
      renameTerminal(renameId, renameName.trim());
    }
    setRenameId(null);
    setRenameName('');
  };

  const headerButtons = (
    <Popover open={newMenuOpen} onOpenChange={setNewMenuOpen}>
      <PopoverTrigger asChild>
        <button
          className="p-1 rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
          title="New terminal"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <button
          onClick={() => handleCreate('blank')}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md hover:bg-accent/70 text-foreground transition-colors"
        >
          <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Blank</span>
        </button>
        <button
          onClick={() => handleCreate('claude')}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md hover:bg-accent/70 text-foreground transition-colors"
        >
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Claude Code</span>
        </button>
      </PopoverContent>
    </Popover>
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
            const isClaude = terminal.type === 'claude';

            return (
              <div
                key={terminal.id}
                onClick={() => handleClick(terminal.id)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  handleStartRename(terminal.id, terminal.name);
                }}
                className={cn(
                  'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer transition-colors mb-1 border border-transparent',
                  isActive
                    ? 'bg-accent/80 text-foreground border-border/55'
                    : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
                )}
              >
                {renameId === terminal.id ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleRename(); }}
                    className="flex-1 min-w-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Input
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={(e) => { if (e.key === 'Escape') setRenameId(null); }}
                      className="h-7 px-2 py-0 text-xs"
                      autoFocus
                    />
                  </form>
                ) : (
                  <>
                    {isClaude
                      ? <Bot className="h-3.5 w-3.5 shrink-0" />
                      : <TerminalSquare className="h-3.5 w-3.5 shrink-0" />
                    }
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
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SidebarSection>
  );
}
