import { useState, useEffect, useCallback } from 'react';

/**
 * Hook that manages draft message persistence with debounced saving.
 *
 * Encapsulates the pattern of reading an initial draft value and
 * debounce-writing changes back to a persistence layer (e.g., session DB).
 *
 * @param initialDraft - The initial draft text loaded from storage (or null/undefined).
 * @param onPersist - Callback invoked (debounced) when the draft changes.
 *                    Receives the current draft string. Pass `undefined` to disable persistence.
 * @param debounceMs - Debounce delay in milliseconds (default: 400).
 */
export function useDraftPersistence(
  initialDraft: string | null | undefined,
  onPersist?: (draft: string) => void,
  debounceMs = 400,
): {
  /** Current draft value. */
  draft: string;
  /** Update the draft value (triggers debounced persistence). */
  setDraft: (value: string) => void;
  /** Clear the draft (sets to empty string and persists immediately). */
  clearDraft: () => void;
} {
  const [draft, setDraftState] = useState(initialDraft ?? '');

  // Debounce-save draft whenever it changes
  useEffect(() => {
    if (!onPersist) return;
    const t = setTimeout(() => {
      onPersist(draft);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [draft, onPersist, debounceMs]);

  const setDraft = useCallback((value: string) => {
    setDraftState(value);
  }, []);

  const clearDraft = useCallback(() => {
    setDraftState('');
    onPersist?.('');
  }, [onPersist]);

  return { draft, setDraft, clearDraft };
}
