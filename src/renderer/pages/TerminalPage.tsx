import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, TerminalSquare } from 'lucide-react';
import { useTerminalsContext } from '../contexts/TerminalsContext';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { reportError } from '../lib/error-handler';

export function TerminalPage() {
  const { terminalId } = useParams<{ terminalId?: string }>();
  const navigate = useNavigate();
  const { currentProjectId, currentProject } = useCurrentProject();
  const { terminals, currentTerminalId, createTerminal, switchTerminal } = useTerminalsContext();

  // Sync URL param with hook state
  useEffect(() => {
    if (terminalId && terminalId !== currentTerminalId) {
      switchTerminal(terminalId);
    }
  }, [terminalId, currentTerminalId, switchTerminal]);

  // If no terminal specified and we have terminals, redirect to first one
  useEffect(() => {
    if (!terminalId && terminals.length > 0) {
      navigate(`/terminal/${terminals[0].id}`, { replace: true });
    }
  }, [terminalId, terminals, navigate]);

  const handleNewTerminal = async () => {
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

  const activeTerminalId = terminalId || currentTerminalId;

  // Empty state — no terminals yet
  if (terminals.length === 0 || !activeTerminalId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <TerminalSquare className="h-12 w-12 opacity-40" />
        <p className="text-sm">No terminals open</p>
        <button
          onClick={handleNewTerminal}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Terminal
        </button>
      </div>
    );
  }

  // Terminal content is rendered by PersistentTerminals in Layout.
  // This page only shows the tab bar when multiple terminals exist.
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {terminals.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border/60 bg-card/50">
          {terminals.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/terminal/${t.id}`)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                t.id === activeTerminalId
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <TerminalSquare className="h-3 w-3" />
              {t.name}
            </button>
          ))}
          <button
            onClick={handleNewTerminal}
            className="p-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
            title="New terminal"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
