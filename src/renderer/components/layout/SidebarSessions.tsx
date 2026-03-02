import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Plus, MoreVertical } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { formatRelativeTimestamp } from '../tasks/task-helpers';
import { Input } from '../ui/input';
import { SidebarSection } from './SidebarSection';

export function SidebarSessions() {
  const { currentProjectId } = useCurrentProject();
  const {
    sessions,
    currentSessionId,
    createSession,
    renameSession,
    deleteSession,
    switchSession,
  } = useProjectChatSessions();
  const navigate = useNavigate();

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuSessionId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCreate = () => {
    const maxNum = sessions.reduce((max, s) => {
      const match = s.name.match(/^Session (\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const name = `Session ${maxNum + 1}`;
    createSession(name)
      .then(() => navigate('/chat'))
      .catch(() => { /* error already set in hook state */ });
  };

  const handleClick = (sessionId: string) => {
    switchSession(sessionId);
    navigate('/chat');
  };

  const handleStartRename = (sessionId: string, currentName: string) => {
    setRenameId(sessionId);
    setRenameName(currentName);
    setMenuSessionId(null);
  };

  const handleRename = () => {
    if (renameId && renameName.trim()) {
      renameSession(renameId, renameName.trim());
    }
    setRenameId(null);
    setRenameName('');
  };

  const handleDelete = (sessionId: string) => {
    deleteSession(sessionId);
    setMenuSessionId(null);
  };

  const createButton = (
    <button
      onClick={handleCreate}
      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      title="New session"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  );

  if (!currentProjectId) {
    return (
      <SidebarSection title="Sessions" storageKey="sessions" trailing={null}>
        <p className="px-3 py-2 text-xs text-muted-foreground">No project selected</p>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection title="Sessions" storageKey="sessions" trailing={createButton}>
      {sessions.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No sessions</p>
      ) : (
        <div className="px-2">
          {sessions.map((session) => {
            const isActive = session.id === currentSessionId;

            return (
              <div
                key={session.id}
                onClick={() => handleClick(session.id)}
                className={cn(
                  'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors mb-0.5',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {renameId === session.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRename();
                    }}
                    className="flex-1 min-w-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Input
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onBlur={handleRename}
                      className="h-6 px-1 py-0 text-xs"
                      autoFocus
                    />
                  </form>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 truncate text-xs">
                      {session.name}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] shrink-0',
                        isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'
                      )}
                    >
                      {formatRelativeTimestamp(session.updatedAt)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (menuSessionId === session.id) {
                          setMenuSessionId(null);
                          return;
                        }
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuPosition({ top: rect.bottom + 4, left: rect.left });
                        setMenuSessionId(session.id);
                      }}
                      className={cn(
                        'p-0.5 rounded hover:bg-muted/50 transition-opacity shrink-0',
                        'opacity-0 group-hover:opacity-100',
                        isActive && 'hover:bg-primary-foreground/20'
                      )}
                      title="More options"
                    >
                      <MoreVertical className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {menuSessionId &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed bg-card border border-border rounded-md shadow-lg z-50 py-1"
            style={{ top: menuPosition.top, left: menuPosition.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() =>
                handleStartRename(
                  menuSessionId,
                  sessions.find((s) => s.id === menuSessionId)?.name || ''
                )
              }
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
            >
              Rename
            </button>
            {sessions.length > 1 && (
              <button
                onClick={() => handleDelete(menuSessionId)}
                className="block w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-muted transition-colors"
              >
                Delete
              </button>
            )}
          </div>,
          document.getElementById('app-root')!
        )}
    </SidebarSection>
  );
}
