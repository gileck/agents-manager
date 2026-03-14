import { useState, useEffect, useCallback, useRef } from 'react';
import type { ThemeConfig, ThemeColors } from '../../shared/types';
import { DEFAULT_THEME_CONFIG, COLOR_VAR_MAP, THEME_PRESETS } from '../theme-presets';

const STYLE_ID = 'theme-overrides';
const SAVE_DEBOUNCE_MS = 300;

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

  return `html:root {\n${rootVars.join('\n')}\n}\n\nhtml.dark {\n${darkVars.join('\n')}\n}`;
}

/**
 * Injects or updates a <style> element in the document head with CSS variable overrides.
 */
function applyStyleOverrides(config: ThemeConfig): void {
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
  }
  styleEl.textContent = generateCssOverrides(config);
  // Always (re-)append to end of <head> so overrides come after base stylesheets
  document.head.appendChild(styleEl);
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
  // Mirror of themeConfig state accessible synchronously (React 18 batching
  // defers state updater execution, so we can't read new state immediately
  // after setState).
  const configRef = useRef<ThemeConfig>(DEFAULT_THEME_CONFIG);

  /**
   * Debounce-persist a theme config to settings via IPC.
   * Cancels any pending save so only the latest config is written.
   */
  const debounceSave = useCallback((config: ThemeConfig) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await window.api.settings.update({ themeConfig: JSON.stringify(config) });
      } catch (err) {
        console.error('Failed to save theme config:', err);
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // Load saved config on mount
  useEffect(() => {
    async function load() {
      try {
        const settings = await window.api.settings.get();
        if (settings.themeConfig) {
          const parsed = JSON.parse(settings.themeConfig) as ThemeConfig;
          configRef.current = parsed;
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
    configRef.current = config;
    setThemeConfigState(config);
    applyStyleOverrides(config);
    debounceSave(config);
  }, [debounceSave]);

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
    configRef.current = DEFAULT_THEME_CONFIG;
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
   * Reads the latest config from a ref (not React state) so we can compute
   * the next config and apply CSS overrides synchronously — React 18 batching
   * defers setState updater execution, making the old pattern unreliable.
   */
  const updateColor = useCallback((
    key: keyof ThemeColors,
    value: string,
    mode: 'light' | 'dark'
  ) => {
    const prev = configRef.current;
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
    configRef.current = next;
    setThemeConfigState(next);
    applyStyleOverrides(next);
    debounceSave(next);
  }, [debounceSave]);

  /**
   * Update the border radius.
   */
  const updateRadius = useCallback((radius: string) => {
    const prev = configRef.current;
    const next: ThemeConfig = { ...prev, name: 'Custom', radius };
    configRef.current = next;
    setThemeConfigState(next);
    applyStyleOverrides(next);
    debounceSave(next);
  }, [debounceSave]);

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
