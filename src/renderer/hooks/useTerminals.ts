import { useState, useEffect, useCallback } from 'react';
import type { TerminalSession, TerminalType } from '../../shared/types';
import { reportError } from '../lib/error-handler';

export function useTerminals() {
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [currentTerminalId, setCurrentTerminalId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.terminals.list();
      setTerminals(list);
    } catch (err) {
      reportError(err, 'List terminals');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for terminal exits and update status
  useEffect(() => {
    const unsub = window.api.on.terminalExited((terminalId, { exitCode }) => {
      setTerminals((prev) =>
        prev.map((t) =>
          t.id === terminalId ? { ...t, status: 'exited' as const, exitCode } : t
        )
      );
    });
    return unsub;
  }, []);

  const createTerminal = useCallback(async (projectId: string, name: string, cwd: string, type: TerminalType = 'blank') => {
    try {
      const session = await window.api.terminals.create(projectId, name, cwd, type);
      setTerminals((prev) => [...prev, session]);
      setCurrentTerminalId(session.id);
      return session;
    } catch (err) {
      reportError(err, 'Create terminal');
      return null;
    }
  }, []);

  const closeTerminal = useCallback(async (terminalId: string) => {
    try {
      await window.api.terminals.close(terminalId);
      setTerminals((prev) => prev.filter((t) => t.id !== terminalId));
      if (currentTerminalId === terminalId) {
        setCurrentTerminalId(null);
      }
    } catch (err) {
      reportError(err, 'Close terminal');
    }
  }, [currentTerminalId]);

  const renameTerminal = useCallback((terminalId: string, name: string) => {
    setTerminals((prev) =>
      prev.map((t) => (t.id === terminalId ? { ...t, name } : t))
    );
  }, []);

  const switchTerminal = useCallback((terminalId: string) => {
    setCurrentTerminalId(terminalId);
  }, []);

  return {
    terminals,
    currentTerminalId,
    createTerminal,
    closeTerminal,
    renameTerminal,
    switchTerminal,
    refresh,
  };
}
