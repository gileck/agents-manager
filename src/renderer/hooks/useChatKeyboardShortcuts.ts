import { useEffect, useCallback } from 'react';

interface UseChatKeyboardShortcutsOptions {
  clearChat: () => void;
  focusInput: () => void;
  enabled?: boolean;
}

/**
 * Minimal chat keyboard shortcuts — session navigation moved to page tabs.
 * Only Cmd+L (focus input) and Cmd+K (clear chat) remain.
 */
export function useChatKeyboardShortcuts({
  clearChat,
  focusInput,
  enabled = true,
}: UseChatKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;
    const hasMod = event.metaKey || event.ctrlKey;
    if (!hasMod) return;

    const key = event.key.toLowerCase();

    if (key === 'l') {
      event.preventDefault();
      focusInput();
      return;
    }

    if (key === 'k') {
      event.preventDefault();
      clearChat();
      return;
    }
  }, [enabled, clearChat, focusInput]);

  useEffect(() => {
    if (enabled) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [enabled, handleKeyDown]);
}
