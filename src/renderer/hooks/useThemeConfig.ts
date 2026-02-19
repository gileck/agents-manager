import { useState, useEffect, useCallback, useRef } from 'react';
import type { ThemeConfig, ThemeColors } from '../../shared/types';
import { DEFAULT_THEME_CONFIG, COLOR_VAR_MAP, THEME_PRESETS } from '../theme-presets';

const STYLE_ID = 'theme-overrides';

/**
 * Generates CSS variable override rules from a ThemeConfig.
 */
function generateCssOverrides(config: ThemeConfig): string {
  const rootVars: string[] = [];
  const darkVars: string[] = [];

  const colorKeys = Object.keys(COLOR_VAR_MAP) as (keyof ThemeColors)[];

  for (const key of colorKeys) {
    const cssVar = COLOR_VAR_MAP[key];
    rootVars.push(`  ${cssVar}: ${config.colors[key]};`);
    darkVars.push(`  ${cssVar}: ${config.darkColors[key]};`);
  }

  rootVars.push(`  --radius: ${config.radius};`);

  return `:root {\n${rootVars.join('\n')}\n}\n\n.dark {\n${darkVars.join('\n')}\n}`;
}

/**
 * Injects or updates a <style> element in the document head with CSS variable overrides.
 */
function applyStyleOverrides(config: ThemeConfig): void {
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = generateCssOverrides(config);
}

/**
 * Removes the injected style overrides, reverting to the defaults defined in globals.css.
 */
function removeStyleOverrides(): void {
  const styleEl = document.getElementById(STYLE_ID);
  if (styleEl) {
    styleEl.remove();
  }
}

/**
 * Hook for loading, saving, and applying theme customizations via CSS variable overrides.
 *
 * - Loads saved ThemeConfig from settings on mount
 * - Applies overrides immediately by injecting a <style> element
 * - Persists changes to settings via IPC
 * - Provides helpers for preset selection and reset
 */
export function useThemeConfig() {
  const [themeConfig, setThemeConfigState] = useState<ThemeConfig>(DEFAULT_THEME_CONFIG);
  const [isLoaded, setIsLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved config on mount
  useEffect(() => {
    async function load() {
      try {
        const settings = await window.api.settings.get();
        if (settings.themeConfig) {
          const parsed = JSON.parse(settings.themeConfig) as ThemeConfig;
          setThemeConfigState(parsed);
          applyStyleOverrides(parsed);
        }
        // If no saved config, the defaults from globals.css are used (no overrides needed)
      } catch (err) {
        console.error('Failed to load theme config:', err);
      } finally {
        setIsLoaded(true);
      }
    }
    load();
  }, []);

  /**
   * Update the theme config, apply it immediately, and debounce-persist to settings.
   */
  const setThemeConfig = useCallback((config: ThemeConfig) => {
    setThemeConfigState(config);
    applyStyleOverrides(config);

    // Debounce save to avoid excessive IPC calls during rapid color adjustments
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await window.api.settings.update({ themeConfig: JSON.stringify(config) });
      } catch (err) {
        console.error('Failed to save theme config:', err);
      }
    }, 300);
  }, []);

  /**
   * Apply a preset theme by name.
   */
  const applyPreset = useCallback((presetName: string) => {
    const preset = THEME_PRESETS.find(p => p.name === presetName);
    if (preset) {
      setThemeConfig({ ...preset });
    }
  }, [setThemeConfig]);

  /**
   * Reset to the default theme (remove all customizations).
   */
  const resetTheme = useCallback(async () => {
    setThemeConfigState(DEFAULT_THEME_CONFIG);
    removeStyleOverrides();
    try {
      await window.api.settings.update({ themeConfig: null });
    } catch (err) {
      console.error('Failed to reset theme config:', err);
    }
  }, []);

  /**
   * Update a single color in the current config (for either light or dark mode).
   */
  const updateColor = useCallback((
    key: keyof ThemeColors,
    value: string,
    mode: 'light' | 'dark'
  ) => {
    setThemeConfigState(prev => {
      const next: ThemeConfig = {
        ...prev,
        name: 'Custom',
        colors: { ...prev.colors },
        darkColors: { ...prev.darkColors },
      };
      if (mode === 'light') {
        next.colors[key] = value;
      } else {
        next.darkColors[key] = value;
      }
      applyStyleOverrides(next);

      // Debounce save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await window.api.settings.update({ themeConfig: JSON.stringify(next) });
        } catch (err) {
          console.error('Failed to save theme config:', err);
        }
      }, 300);

      return next;
    });
  }, []);

  /**
   * Update the border radius.
   */
  const updateRadius = useCallback((radius: string) => {
    setThemeConfigState(prev => {
      const next: ThemeConfig = { ...prev, name: 'Custom', radius };
      applyStyleOverrides(next);

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await window.api.settings.update({ themeConfig: JSON.stringify(next) });
        } catch (err) {
          console.error('Failed to save theme config:', err);
        }
      }, 300);

      return next;
    });
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    themeConfig,
    isLoaded,
    setThemeConfig,
    applyPreset,
    resetTheme,
    updateColor,
    updateRadius,
  };
}
