import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, CheckSquare, Loader2, Check, EyeOff, X, Clock, MessageCircleQuestion, MessageSquare } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { formatRelativeTimestamp } from '../tasks/task-helpers';
import { Input } from '../ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { SidebarSection } from './SidebarSection';
import { reportError } from '../../lib/error-handler';
import { ThreadIntentIcon } from '../chat/ThreadIntentIcon';
import { THREAD_INTENTS, type ThreadIntent } from '../../lib/thread-intent-prompts';
import type { TaskChatSessionWithTitle, RunningAgent } from '../../../shared/types';
import { useActiveAgents } from '../../hooks/useActiveAgents';

export function SidebarSessions() {
  const { currentProjectId } = useCurrentProject();
  const {
    sessions,
    currentSessionId,
    createSession,
    updateSession,
    renameSession,
    hideSession,
    hideAllSessions,
    switchSession,
  } = useProjectChatSessions();
  const navigate = useNavigate();
  const location = useLocation();
  const onChatPage = location.pathname === '/chat' || location.pathname.startsWith('/chat/');

  const [taskSessions, setTaskSessions] = useState<TaskChatSessionWithTitle[]>([]);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const { agents } = useActiveAgents();
  const [completedFlash, setCompletedFlash] = useState<Set<string>>(new Set());
  const prevAgentsRef = useRef<RunningAgent[]>([]);
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const prev = prevAgentsRef.current;
    agents.forEach((agent) => {
      if (agent.status === 'completed') {
        const wasRunning = prev.some(
          (a) => a.sessionId === agent.sessionId && (a.status === 'running' || a.status === 'waiting_for_input')
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

  const handleCreate = (intent?: ThreadIntent) => {
    setNewSessionOpen(false);
    const maxNum = sessions.reduce((max, s) => {
      const match = s.name.match(/^Session (\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const defaultName = `Session ${maxNum + 1}`;
    const name = intent ? THREAD_INTENTS[intent].label : defaultName;
    createSession(name, intent)
      .then(async (newSession) => {
        if (!newSession?.id) { navigate('/chat'); return; }
        // If an intent was chosen, attach the system prompt
        if (intent) {
          await updateSession(newSession.id, {
            systemPromptAppend: THREAD_INTENTS[intent].systemPromptAppend,
          });
        }
        navigate(`/chat/${newSession.id}`);
      })
      .catch((err) => reportError(err, 'Create session'));
  };

  const handleClick = (sessionId: string) => {
    switchSession(sessionId);
    navigate(`/chat/${sessionId}`);
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

  const handleHide = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    hideSession(sessionId).catch((err) => reportError(err, 'Hide session'));
  };

  const handleClearAll = () => {
    hideAllSessions().catch((err) => reportError(err, 'Clear all sessions'));
  };

  const handleTaskSessionClick = (taskSession: TaskChatSessionWithTitle) => {
    try {
      localStorage.setItem(`taskDetail.tab.${taskSession.scopeId}`, 'chat');
    } catch {
      // Non-critical: tab preference won't be pre-set
    }
    navigate(`/tasks/${taskSession.scopeId}`);
  };

  const handleHideTaskSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await window.api.chatSession.hide(sessionId);
      setTaskSessions((prev) => prev.filter((ts) => ts.id !== sessionId));
    } catch (err) {
      reportError(err, 'Hide task session');
    }
  };

  const headerButtons = (
    <div className="flex items-center gap-0.5">
      {sessions.length > 0 && (
        <button
          onClick={handleClearAll}
          className="p-1 rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
          title="Clear all from sidebar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        onClick={() => navigate('/threads')}
        className="p-1 rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
        title="View thread history"
      >
        <Clock className="h-3.5 w-3.5" />
      </button>
      <Popover open={newSessionOpen} onOpenChange={setNewSessionOpen}>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
            title="New session"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-48 p-1">
          <button
            onClick={() => handleCreate()}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md hover:bg-accent/70 text-foreground transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Blank</span>
          </button>
          {(Object.entries(THREAD_INTENTS) as [ThreadIntent, typeof THREAD_INTENTS[ThreadIntent]][]).map(([key, config]) => (
            <button
              key={key}
              onClick={() => handleCreate(key)}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-md hover:bg-accent/70 text-foreground transition-colors"
            >
              <ThreadIntentIcon intent={key} className="h-3.5 w-3.5" />
              <span>{config.label}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
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
            const isAgentRunning = agents.some(
              (a) => a.sessionId === session.id && a.status === 'running'
            );
            const isWaiting = agents.some(
              (a) => a.sessionId === session.id && a.status === 'waiting_for_input'
            );
            const isActiveAgent = isAgentRunning || isWaiting;
            const isDone = !isActiveAgent && completedFlash.has(session.id);

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
                    <div className="shrink-0 text-muted-foreground">
                      {session.threadIntent ? (
                        <ThreadIntentIcon intent={session.threadIntent} className="h-3.5 w-3.5" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <span className="flex-1 min-w-0 truncate text-xs font-medium">
                      {session.name}
                    </span>
                    {isWaiting ? (
                      <MessageCircleQuestion className="h-3 w-3 text-amber-500 shrink-0" />
                    ) : isAgentRunning ? (
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
                    <button
                      onClick={(e) => handleHide(e, session.id)}
                      className={cn(
                        'p-0.5 rounded hover:bg-accent transition-opacity shrink-0',
                        'opacity-0 group-hover:opacity-100',
                        isActive && 'hover:bg-primary-foreground/20'
                      )}
                      title="Remove from sidebar"
                    >
                      <EyeOff className="h-3 w-3" />
                    </button>
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
              const isTaskRunning = agents.some(
                (a) => a.sessionId === ts.id && a.status === 'running'
              );
              const isTaskWaiting = agents.some(
                (a) => a.sessionId === ts.id && a.status === 'waiting_for_input'
              );
              const isTaskActive = isTaskRunning || isTaskWaiting;
              const isDone = !isTaskActive && completedFlash.has(ts.id);
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
                  {isTaskWaiting ? (
                    <MessageCircleQuestion className="h-3 w-3 text-amber-500 shrink-0" />
                  ) : isTaskRunning ? (
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
                    onClick={(e) => handleHideTaskSession(e, ts.id)}
                    className={cn(
                      'p-0.5 rounded hover:bg-accent transition-opacity shrink-0',
                      'opacity-0 group-hover:opacity-100'
                    )}
                    title="Remove from sidebar"
                  >
                    <EyeOff className="h-3 w-3" />
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
