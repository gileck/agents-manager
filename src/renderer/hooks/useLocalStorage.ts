import { useState, useEffect } from 'react';
import type React from 'react';

export function useLocalStorage<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  // Re-sync state when the key changes (e.g. navigating between tasks)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      setValue(stored ? JSON.parse(stored) : defaultValue);
    } catch {
      setValue(defaultValue);
    }
  }, [key]); // intentionally excludes defaultValue — only re-sync when key changes

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}
