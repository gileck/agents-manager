import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { SHORTCUT_REGISTRY, normalizeCombo } from '../lib/keyboardShortcuts';

type ShortcutOverrides = Record<string, string>;

export function useKeyboardShortcutsConfig() {
  const [overrides, setOverrides] = useLocalStorage<ShortcutOverrides>('keyboard-shortcuts-v1', {});

  const getCombo = useCallback((id: string): string => {
    const override = overrides[id];
    if (override) return override;
    const def = SHORTCUT_REGISTRY.find(s => s.id === id);
    return def?.defaultCombo ?? '';
  }, [overrides]);

  const setCombo = useCallback((id: string, combo: string) => {
    setOverrides(prev => ({ ...prev, [id]: normalizeCombo(combo) }));
  }, [setOverrides]);

  const resetCombo = useCallback((id: string) => {
    setOverrides(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [setOverrides]);

  const resetAll = useCallback(() => {
    setOverrides({});
  }, [setOverrides]);

  const hasConflict = useCallback((combo: string, excludeId?: string): string | null => {
    const normalized = normalizeCombo(combo);
    for (const def of SHORTCUT_REGISTRY) {
      if (def.id === excludeId) continue;
      if (def.notCustomizable) continue;
      const existing = overrides[def.id] ? normalizeCombo(overrides[def.id]) : normalizeCombo(def.defaultCombo);
      if (existing === normalized) return def.id;
    }
    return null;
  }, [overrides]);

  return { getCombo, setCombo, resetCombo, resetAll, hasConflict };
}
