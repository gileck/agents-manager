import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, CheckSquare, Trash2, Loader2, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { formatRelativeTimestamp } from '../tasks/task-helpers';
import { Input } from '../ui/input';
import { SidebarSection } from './SidebarSection';
import { reportError } from '../../lib/error-handler';
import type { TaskChatSessionWithTitle, RunningAgent } from '../../../shared/types';
import { useActiveAgents } from '../../hooks/useActiveAgents';

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
  const location = useLocation();
  const onChatPage = location.pathname === '/chat';

  const [taskSessions, setTaskSessions] = useState<TaskChatSessionWithTitle[]>([]);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');

  const { agents } = useActiveAgents();
  const [completedFlash, setCompletedFlash] = useState<Set<string>>(new Set());
  const prevAgentsRef = useRef<RunningAgent[]>([]);
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const prev = prevAgentsRef.current;
    agents.forEach((agent) => {
      if (agent.status === 'completed') {
        const wasRunning = prev.some(
          (a) => a.sessionId === agent.sessionId && a.status === 'running'
        );
        if (wasRunning) {
          setCompletedFlash((s) => new Set(s).add(agent.sessionId));
          if (flashTimersRef.current.has(agent.sessionId)) {
            clearTimeout(flashTimersRef.current.get(agent.sessionId)!);
          }
          const timer = setTimeout(() => {
            setCompletedFlash((s) => {
              const next = new Set(s);
              next.delete(agent.sessionId);
              return next;
            });
            flashTimersRef.current.delete(agent.sessionId);
          }, 3000);
          flashTimersRef.current.set(agent.sessionId, timer);
        }
      }
    });
    prevAgentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    return () => {
      flashTimersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!currentProjectId) return;
    window.api.chatSession.listTaskSessions(currentProjectId)
      .then(setTaskSessions)
      .catch((err) => reportError(err, 'Load task sessions'));
  }, [currentProjectId, sessions]);

  const handleCreate = () => {
    const maxNum = sessions.reduce((max, s) => {
      const match = s.name.match(/^Session (\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const name = `Session ${maxNum + 1}`;
    createSession(name)
      .then(() => navigate('/chat'))
      .catch((err) => reportError(err, 'Create session'));
  };

  const handleClick = (sessionId: string) => {
    switchSession(sessionId);
    navigate('/chat');
  };

  const handleStartRename = (sessionId: string, currentName: string) => {
    setRenameId(sessionId);
    setRenameName(currentName);
  };

  const handleRename = () => {
    if (renameId && renameName.trim()) {
      renameSession(renameId, renameName.trim());
    }
    setRenameId(null);
    setRenameName('');
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    deleteSession(sessionId);
  };

  const handleTaskSessionClick = (taskSession: TaskChatSessionWithTitle) => {
    try {
      localStorage.setItem(`taskDetail.tab.${taskSession.scopeId}`, 'chat');
    } catch {
      // Non-critical: tab preference won't be pre-set
    }
    navigate(`/tasks/${taskSession.scopeId}`);
  };

  const handleDeleteTaskSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await window.api.chatSession.delete(sessionId);
      setTaskSessions((prev) => prev.filter((ts) => ts.id !== sessionId));
    } catch (err) {
      reportError(err, 'Delete task session');
    }
  };

  const headerButtons = (
    <button
      onClick={handleCreate}
      className="p-1 rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
      title="New session"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  );

  if (!currentProjectId) {
    return (
      <SidebarSection title="Threads" storageKey="sessions" trailing={null}>
        <p className="px-3 py-2 text-xs text-muted-foreground">No project selected</p>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection title="Threads" storageKey="sessions" trailing={headerButtons}>
      {sessions.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No sessions</p>
      ) : (
        <div className="px-1">
          {[...sessions].sort((a, b) => b.updatedAt - a.updatedAt).map((session) => {
            const isActive = onChatPage && session.id === currentSessionId;
            const isRunning = agents.some(
              (a) => a.sessionId === session.id && a.status === 'running'
            );
            const isDone = !isRunning && completedFlash.has(session.id);

            return (
              <div
                key={session.id}
                onClick={() => handleClick(session.id)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  handleStartRename(session.id, session.name);
                }}
                className={cn(
                  'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer transition-colors mb-1 border border-transparent',
                  isActive
                    ? 'bg-accent/80 text-foreground border-border/55'
                    : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
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
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setRenameId(null);
                      }}
                      className="h-7 px-2 py-0 text-xs"
                      autoFocus
                    />
                  </form>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 truncate text-xs font-medium">
                      {session.name}
                    </span>
                    {isRunning ? (
                      <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                    ) : isDone ? (
                      <div className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-500/80 text-white shrink-0">
                        <Check className="h-2 w-2" />
                      </div>
                    ) : (
                      <span
                        className={cn(
                          'text-[10px] shrink-0',
                          isActive ? 'text-foreground/60' : 'text-muted-foreground'
                        )}
                      >
                        {formatRelativeTimestamp(session.updatedAt)}
                      </span>
                    )}
                    {sessions.length > 1 && (
                      <button
                        onClick={(e) => handleDelete(e, session.id)}
                        className={cn(
                          'p-0.5 rounded hover:bg-accent transition-opacity shrink-0',
                          'opacity-0 group-hover:opacity-100',
                          isActive && 'hover:bg-primary-foreground/20'
                        )}
                        title="Delete session"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {taskSessions.length > 0 && (
        <>
          <div className="px-3 pt-3 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Task Sessions
            </span>
          </div>
          <div className="px-1">
            {taskSessions.map((ts) => {
              const isActive = location.pathname === `/tasks/${ts.scopeId}`;
              const isRunning = agents.some(
                (a) => a.sessionId === ts.id && a.status === 'running'
              );
              const isDone = !isRunning && completedFlash.has(ts.id);
              return (
                <div
                  key={ts.id}
                  onClick={() => handleTaskSessionClick(ts)}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer transition-colors mb-1 border border-transparent',
                    isActive
                      ? 'bg-accent/80 text-foreground border-border/55'
                      : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
                  )}
                >
                  <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-xs font-medium">
                    {ts.taskTitle}
                  </span>
                  {isRunning ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                  ) : isDone ? (
                    <div className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-500/80 text-white shrink-0">
                      <Check className="h-2 w-2" />
                    </div>
                  ) : (
                    <span
                      className={cn(
                        'text-[10px] shrink-0',
                        isActive ? 'text-foreground/60' : 'text-muted-foreground'
                      )}
                    >
                      {formatRelativeTimestamp(ts.updatedAt)}
                    </span>
                  )}
                  <button
                    onClick={(e) => handleDeleteTaskSession(e, ts.id)}
                    className={cn(
                      'p-0.5 rounded hover:bg-accent transition-opacity shrink-0',
                      'opacity-0 group-hover:opacity-100'
                    )}
                    title="Delete session"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </SidebarSection>
  );
}
