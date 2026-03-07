import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, MoreVertical, Loader2, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ChatSession, RunningAgent } from '../../../shared/types';
import { Input } from '../ui/input';

interface SessionTabsProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  activeAgents: RunningAgent[];
  onSessionChange: (sessionId: string) => void;
  onSessionCreate: (name: string) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionDelete: (sessionId: string) => void;
}

export function SessionTabs({
  sessions,
  currentSessionId,
  activeAgents,
  onSessionChange,
  onSessionCreate,
  onSessionRename,
  onSessionDelete,
}: SessionTabsProps) {
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameSessionName, setRenameSessionName] = useState('');
  const [contextMenuSession, setContextMenuSession] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuSession(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNewSession = () => {
    const name = `Session ${sessions.length + 1}`;
    onSessionCreate(name);
  };

  const handleStartRename = (sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId);
    setRenameSessionName(currentName);
    setContextMenuSession(null);
  };

  const handleRename = () => {
    if (renameSessionId && renameSessionName.trim()) {
      onSessionRename(renameSessionId, renameSessionName.trim());
      setRenameSessionId(null);
      setRenameSessionName('');
    }
  };

  const handleDelete = (sessionId: string) => {
    onSessionDelete(sessionId);
    setContextMenuSession(null);
  };

  const getSessionAgentStatus = (sessionId: string) => {
    const sessionAgents = activeAgents.filter(agent => agent.sessionId === sessionId);
    const runningCount = sessionAgents.filter(agent => agent.status === 'running').length;
    const completedCount = sessionAgents.filter(agent => agent.status === 'completed').length;

    return { runningCount, completedCount, hasAgents: sessionAgents.length > 0 };
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
      {sessions.map((session) => {
        const { runningCount, completedCount } = getSessionAgentStatus(session.id);
        const isActive = session.id === currentSessionId;

        return (
          <div
            key={session.id}
            className={cn(
              'relative group flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all text-sm border border-transparent',
              isActive
                ? 'bg-accent/80 text-foreground border-border/55 font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/45'
            )}
            onClick={() => onSessionChange(session.id)}
          >
            {runningCount > 0 && (
              <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            )}

            {completedCount > 0 && runningCount === 0 && (
              <div className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-500/80 text-white shrink-0">
                <Check className="h-2 w-2" />
              </div>
            )}

            {renameSessionId === session.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRename();
                }}
                className="flex items-center"
              >
                <Input
                  value={renameSessionName}
                  onChange={(e) => setRenameSessionName(e.target.value)}
                  onBlur={handleRename}
                  className="h-5 px-1.5 py-0.5 text-xs w-24"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              </form>
            ) : (
              <span
                className="truncate max-w-[120px]"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleStartRename(session.id, session.name);
                }}
              >
                {session.name}
              </span>
            )}

            {(runningCount > 0 || completedCount > 0) && (
              <span className="text-[10px] text-muted-foreground/70">
                {runningCount > 0 ? runningCount : completedCount}
              </span>
            )}

            {sessions.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(session.id);
                }}
                className={cn(
                  'p-0.5 rounded hover:bg-foreground/10 transition-opacity shrink-0',
                  'opacity-0 group-hover:opacity-100'
                )}
                title="Close session"
              >
                <X className="h-3 w-3" />
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (contextMenuSession === session.id) {
                  setContextMenuSession(null);
                  return;
                }
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenuPosition({ top: rect.bottom + 4, left: rect.left });
                setContextMenuSession(session.id);
              }}
              className={cn(
                'p-0.5 rounded hover:bg-foreground/10 transition-opacity shrink-0',
                'opacity-0 group-hover:opacity-100'
              )}
              title="More options"
            >
              <MoreVertical className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <button
        onClick={handleNewSession}
        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/45 rounded-lg transition-colors shrink-0 border border-transparent hover:border-border/55"
        title="New session"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {contextMenuSession && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed bg-card/95 border border-border/80 rounded-xl shadow-[0_16px_30px_hsl(var(--background)/0.45)] z-50 py-1 min-w-[140px] backdrop-blur-md"
          style={{ top: menuPosition.top, left: menuPosition.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleStartRename(contextMenuSession, sessions.find(s => s.id === contextMenuSession)?.name || '')}
            className="block w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            Rename
          </button>
          {sessions.length > 1 && (
            <button
              onClick={() => handleDelete(contextMenuSession)}
              className="block w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-muted transition-colors"
            >
              Delete
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
