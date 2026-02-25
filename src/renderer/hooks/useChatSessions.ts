import { useState, useEffect, useCallback } from 'react';
import { ChatSession } from '../../shared/types';

export function useChatSessions(projectId: string | null) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load sessions when project changes
  useEffect(() => {
    if (!projectId) {
      setSessions([]);
      setCurrentSessionId(null);
      return;
    }

    setLoading(true);
    setError(null);

    window.api.chatSession
      .list(projectId)
      .then((loadedSessions) => {
        setSessions(loadedSessions);

        // If no sessions exist, create a default one
        if (loadedSessions.length === 0) {
          return window.api.chatSession.create(projectId, 'General').then((newSession) => {
            setSessions([newSession]);
            setCurrentSessionId(newSession.id);
          });
        } else {
          // Set the first session as current if none selected
          if (!currentSessionId || !loadedSessions.find(s => s.id === currentSessionId)) {
            setCurrentSessionId(loadedSessions[0].id);
          }
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const createSession = useCallback(
    async (name: string) => {
      if (!projectId) return;

      try {
        const newSession = await window.api.chatSession.create(projectId, name);
        setSessions((prev) => [...prev, newSession]);
        setCurrentSessionId(newSession.id);
        return newSession;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [projectId]
  );

  const renameSession = useCallback(async (sessionId: string, newName: string) => {
    try {
      const updatedSession = await window.api.chatSession.update(sessionId, newName);
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
              setCurrentSessionId(remainingSessions[0].id);
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

  const switchSession = useCallback((sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      setCurrentSessionId(sessionId);
    }
  }, [sessions]);

  return {
    sessions,
    currentSessionId,
    currentSession: sessions.find((s) => s.id === currentSessionId) || null,
    loading,
    error,
    createSession,
    renameSession,
    deleteSession,
    switchSession,
  };
}