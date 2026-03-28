import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatSession, PermissionMode } from '../../shared/types';

export interface ChatScope {
  type: 'project' | 'task';
  id: string;
}

const storageKey = (scope: ChatScope) => `chat.currentSessionId.${scope.type}:${scope.id}`;

export function useChatSessions(scope: ChatScope | null) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref so callbacks always see the latest scope without re-creating
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // Stable scope key for dependency tracking
  const scopeKey = scope ? `${scope.type}:${scope.id}` : null;

  // Load sessions when scope changes
  useEffect(() => {
    const currentScope = scopeRef.current;
    if (!currentScope) {
      setSessions([]);
      setCurrentSessionId(null);
      return;
    }

    // Clear stale sessions immediately so old tabs don't remain clickable during load
    setSessions([]);
    setCurrentSessionId(null);
    setLoading(true);
    setError(null);

    window.api.chatSession
      .list(currentScope.type, currentScope.id)
      .then((loadedSessions) => {
        setSessions(loadedSessions);

        // If no sessions exist, create a default one
        if (loadedSessions.length === 0) {
          return window.api.chatSession.create(currentScope.type, currentScope.id, 'General').then((newSession) => {
            setSessions([newSession]);
            setCurrentSessionId(newSession.id);
            localStorage.setItem(storageKey(currentScope), newSession.id);
          });
        } else {
          // Restore persisted session if it still exists, otherwise fall back to first
          const stored = localStorage.getItem(storageKey(currentScope));
          const match = stored ? loadedSessions.find(s => s.id === stored) : undefined;
          const nextId = match ? match.id : loadedSessions[0].id;
          setCurrentSessionId(nextId);
          localStorage.setItem(storageKey(currentScope), nextId);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [scopeKey]);

  // Patch sessions in real-time when the daemon auto-renames a session
  useEffect(() => {
    const unsubscribe = window.api.on.chatSessionRenamed((_sessionId, updatedSession) => {
      setSessions((prev) => prev.map((s) => (s.id === updatedSession.id ? updatedSession : s)));
    });
    return () => { unsubscribe(); };
  }, []);

  const createSession = useCallback(
    async (name: string, threadIntent?: string) => {
      const currentScope = scopeRef.current;
      if (!currentScope) return;

      try {
        const newSession = await window.api.chatSession.create(currentScope.type, currentScope.id, name, undefined, threadIntent);
        setSessions((prev) => [...prev, newSession]);
        setCurrentSessionId(newSession.id);
        localStorage.setItem(storageKey(currentScope), newSession.id);
        return newSession;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [scopeKey]
  );

  const renameSession = useCallback(async (sessionId: string, newName: string) => {
    try {
      const updatedSession = await window.api.chatSession.update(sessionId, { name: newName });
      if (updatedSession) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? updatedSession : s))
        );
      }
      return updatedSession;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (sessions.length <= 1) {
        setError('Cannot delete the last session');
        return false;
      }

      try {
        const success = await window.api.chatSession.delete(sessionId);
        if (success) {
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));

          // If deleting current session, switch to another one
          if (sessionId === currentSessionId) {
            const remainingSessions = sessions.filter((s) => s.id !== sessionId);
            if (remainingSessions.length > 0) {
              const currentScope = scopeRef.current;
              setCurrentSessionId(remainingSessions[0].id);
              if (currentScope) localStorage.setItem(storageKey(currentScope), remainingSessions[0].id);
            }
          }
        }
        return success;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [sessions, currentSessionId]
  );

  const updateSession = useCallback(async (sessionId: string, input: { name?: string; agentLib?: string | null; model?: string | null; permissionMode?: PermissionMode | null; systemPromptAppend?: string | null; enableStreaming?: boolean; enableStreamingInput?: boolean; draft?: string | null; threadIntent?: string | null }) => {
    try {
      const updatedSession = await window.api.chatSession.update(sessionId, input);
      if (updatedSession) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? updatedSession : s))
        );
      }
      return updatedSession;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    const currentScope = scopeRef.current;
    setCurrentSessionId(sessionId);
    if (currentScope) localStorage.setItem(storageKey(currentScope), sessionId);
  }, []);

  const unhideSession = useCallback(
    async (sessionId: string) => {
      try {
        const success = await window.api.chatSession.unhide(sessionId);
        if (success) {
          // Re-add the session to the local list if not already present
          const existing = sessions.find((s) => s.id === sessionId);
          if (!existing) {
            // Fetch the full session from the server so we have accurate data
            const fetched = await window.api.chatSession.list(
              scopeRef.current?.type ?? 'project',
              scopeRef.current?.id ?? '',
            );
            setSessions(fetched);
          }
        }
        return success;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [sessions]
  );

  const hideSession = useCallback(
    async (sessionId: string) => {
      if (sessions.length <= 1) {
        // Last visible session: auto-create replacement before hiding
        const currentScope = scopeRef.current;
        if (!currentScope) return false;
        try {
          await window.api.chatSession.hide(sessionId);
          setSessions([]);
          setCurrentSessionId(null);
          const newSession = await window.api.chatSession.create(currentScope.type, currentScope.id, 'General');
          setSessions([newSession]);
          setCurrentSessionId(newSession.id);
          localStorage.setItem(storageKey(currentScope), newSession.id);
          return true;
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          throw err;
        }
      }

      try {
        const success = await window.api.chatSession.hide(sessionId);
        if (success) {
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
          if (sessionId === currentSessionId) {
            const remaining = sessions.filter((s) => s.id !== sessionId);
            if (remaining.length > 0) {
              const currentScope = scopeRef.current;
              setCurrentSessionId(remaining[0].id);
              if (currentScope) localStorage.setItem(storageKey(currentScope), remaining[0].id);
            }
          }
        }
        return success;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [sessions, currentSessionId]
  );

  const hideAllSessions = useCallback(async () => {
    const currentScope = scopeRef.current;
    if (!currentScope) return;

    try {
      await window.api.chatSession.hideAll(currentScope.id);
      setSessions([]);
      setCurrentSessionId(null);

      const newSession = await window.api.chatSession.create(currentScope.type, currentScope.id, 'General');
      setSessions([newSession]);
      setCurrentSessionId(newSession.id);
      localStorage.setItem(storageKey(currentScope), newSession.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  const clearAllSessions = useCallback(async () => {
    const currentScope = scopeRef.current;
    if (!currentScope) return;

    try {
      await Promise.all(sessions.map((s) => window.api.chatSession.delete(s.id)));
      setSessions([]);
      setCurrentSessionId(null);

      const newSession = await window.api.chatSession.create(currentScope.type, currentScope.id, 'General');
      setSessions([newSession]);
      setCurrentSessionId(newSession.id);
      localStorage.setItem(storageKey(currentScope), newSession.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [sessions]);

  const clearError = useCallback(() => setError(null), []);

  return {
    sessions,
    currentSessionId,
    currentSession: sessions.find((s) => s.id === currentSessionId) || null,
    loading,
    error,
    clearError,
    createSession,
    renameSession,
    updateSession,
    deleteSession,
    hideSession,
    unhideSession,
    hideAllSessions,
    clearAllSessions,
    switchSession,
  };
}
