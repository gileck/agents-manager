import { useState, useEffect, useCallback } from 'react';
import type { AppSettings } from '@shared/types';

type Theme = 'light' | 'dark' | 'system';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  // Apply theme to document
  const applyTheme = useCallback((newTheme: Theme) => {
    let effectiveTheme: 'light' | 'dark';

    if (newTheme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } else {
      effectiveTheme = newTheme;
    }

    setResolvedTheme(effectiveTheme);

    if (effectiveTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // Load theme from settings
  useEffect(() => {
    async function loadTheme() {
      try {
        const settings = await window.api.settings.get();
        setTheme(settings.theme);
        applyTheme(settings.theme);
      } catch (error) {
        console.error('Failed to load theme:', error);
        applyTheme('system');
      }
    }

    loadTheme();
  }, [applyTheme]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, applyTheme]);

  // Update theme and save to settings
  const updateTheme = useCallback(async (newTheme: Theme) => {
    setTheme(newTheme);
    applyTheme(newTheme);

    try {
      await window.api.settings.update({ theme: newTheme });
    } catch (error) {
      console.error('Failed to save theme:', error);
    }
  }, [applyTheme]);

  return { theme, resolvedTheme, setTheme: updateTheme };
}
