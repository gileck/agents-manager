/**
 * React context for the active chat preset.
 *
 * Wrap a subtree with `<ChatPresetProvider>` to make the resolved `ChatPreset`
 * available to any descendant via `usePreset()`.
 */

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import type { ChatPreset } from './ChatPreset';
import { getPreset, DEFAULT_PRESET_NAME } from './registry';

// Ensure the default preset is registered before any context usage.
import './default';

interface ChatPresetContextValue {
  /** The currently active preset object. */
  preset: ChatPreset;
  /** The raw preset name persisted in settings. */
  presetName: string;
}

const ChatPresetCtx = createContext<ChatPresetContextValue | null>(null);

interface ChatPresetProviderProps {
  children: React.ReactNode;
}

/**
 * Provides the active chat preset to the component tree.
 *
 * Reads `chatPreset` from AppSettings on mount and resolves it via the
 * preset registry. Falls back to `"default"` when the setting is absent
 * or references an unknown preset.
 */
export function ChatPresetProvider({ children }: ChatPresetProviderProps) {
  const [presetName, setPresetName] = useState<string>(DEFAULT_PRESET_NAME);

  useEffect(() => {
    window.api.settings.get().then((s) => {
      const name = s.chatPreset;
      if (name) {
        setPresetName(name);
      }
    }).catch(() => {
      // Ignore — keep default.
    });
  }, []);

  const value = useMemo<ChatPresetContextValue>(() => ({
    preset: getPreset(presetName),
    presetName,
  }), [presetName]);

  return (
    <ChatPresetCtx.Provider value={value}>
      {children}
    </ChatPresetCtx.Provider>
  );
}

/** Retrieve the current chat preset from context. */
export function usePreset(): ChatPresetContextValue {
  const ctx = useContext(ChatPresetCtx);
  if (!ctx) {
    throw new Error('usePreset() must be used within a <ChatPresetProvider>.');
  }
  return ctx;
}
