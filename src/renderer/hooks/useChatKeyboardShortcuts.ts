import { useEffect, useCallback } from 'react';
import type { ChatSession } from '../../shared/types';

interface UseChatKeyboardShortcutsOptions {
  sessions: ChatSession[];
  currentSessionId: string | null;
  switchSession: (id: string) => void;
  createSession: (name: string) => void;
  deleteSession: (id: string) => void;
  clearChat: () => void;
  focusInput: () => void;
  enabled?: boolean;
}

/**
 * Custom hook to handle keyboard shortcuts for chat session navigation
 *
 * Shortcuts (Cmd on Mac, Ctrl on Win/Linux):
 * - Cmd+N: New session
 * - Cmd+W: Close current session (if more than one exists)
 * - Cmd+[: Previous session
 * - Cmd+]: Next session
 * - Cmd+1–9: Jump to session by index
 * - Cmd+L: Focus the chat input
 * - Cmd+K: Clear conversation
 */
export function useChatKeyboardShortcuts({
  sessions,
  currentSessionId,
  switchSession,
  createSession,
  deleteSession,
  clearChat,
  focusInput,
  enabled = true,
}: UseChatKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;
    if (!event.metaKey && !event.ctrlKey) return;

    const currentIndex = sessions.findIndex(s => s.id === currentSessionId);

    switch (event.key) {
      case 'n':
      case 'N': {
        event.preventDefault();
        createSession('New Session');
        break;
      }

      case 'w':
      case 'W': {
        if (sessions.length > 1 && currentSessionId) {
          event.preventDefault();
          deleteSession(currentSessionId);
        }
        break;
      }

      case '[': {
        event.preventDefault();
        if (currentIndex > 0) {
          switchSession(sessions[currentIndex - 1].id);
        }
        break;
      }

      case ']': {
        event.preventDefault();
        if (currentIndex >= 0 && currentIndex < sessions.length - 1) {
          switchSession(sessions[currentIndex + 1].id);
        }
        break;
      }

      case 'l':
      case 'L': {
        event.preventDefault();
        focusInput();
        break;
      }

      case 'k':
      case 'K': {
        event.preventDefault();
        clearChat();
        break;
      }

      default: {
        // Cmd+1 through Cmd+9
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 9) {
          const target = sessions[digit - 1];
          if (target) {
            event.preventDefault();
            switchSession(target.id);
          }
        }
        break;
      }
    }
  }, [enabled, sessions, currentSessionId, switchSession, createSession, deleteSession, clearChat, focusInput]);

  useEffect(() => {
    if (enabled) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [enabled, handleKeyDown]);
}
