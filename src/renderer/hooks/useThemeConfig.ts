import { useState, useEffect, useCallback, useRef } from 'react';
import type { ThemeConfig, ThemeColors } from '../../shared/types';
import { DEFAULT_THEME_CONFIG, COLOR_VAR_MAP, THEME_PRESETS } from '../theme-presets';
import { useCurrentProject } from '../contexts/CurrentProjectContext';

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
 * Theme config is stored **per-project** in the project's `config.themeConfig` field.
 * This means each project window gets its own color theme — a strong visual signal
 * for which project you're working on.
 *
 * Falls back to global settings.themeConfig if no project is selected.
 */
export function useThemeConfig() {
  const { currentProjectId, currentProject } = useCurrentProject();
  const [themeConfig, setThemeConfigState] = useState<ThemeConfig>(DEFAULT_THEME_CONFIG);
  const [isLoaded, setIsLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef<ThemeConfig>(DEFAULT_THEME_CONFIG);
  const loadedProjectIdRef = useRef<string | null>(null);

  /**
   * Save theme config to the current project's config (or global settings as fallback).
   */
  const saveThemeConfig = useCallback(async (config: ThemeConfig | null) => {
    const projectId = currentProjectId;
    if (projectId) {
      try {
        const project = await window.api.projects.get(projectId);
        if (project) {
          const updatedConfig = { ...project.config, themeConfig: config ? JSON.stringify(config) : null };
          await window.api.projects.update(projectId, { config: updatedConfig });
        }
      } catch (err) {
        console.error('Failed to save project theme config:', err);
      }
    } else {
      // Fallback: save to global settings
      try {
        await window.api.settings.update({ themeConfig: config ? JSON.stringify(config) : null });
      } catch (err) {
        console.error('Failed to save theme config:', err);
      }
    }
  }, [currentProjectId]);

  /**
   * Debounce-persist a theme config.
   */
  const debounceSave = useCallback((config: ThemeConfig) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveThemeConfig(config);
    }, SAVE_DEBOUNCE_MS);
  }, [saveThemeConfig]);

  // Load theme config when project changes
  useEffect(() => {
    async function load() {
      try {
        let themeConfigStr: string | null = null;

        if (currentProjectId && currentProject) {
          // Read from project config
          themeConfigStr = (currentProject.config?.themeConfig as string) ?? null;
        }

        if (!themeConfigStr && !currentProjectId) {
          // No project — fall back to global settings
          const settings = await window.api.settings.get();
          themeConfigStr = settings.themeConfig;
        }

        if (themeConfigStr) {
          const parsed = JSON.parse(themeConfigStr) as ThemeConfig;
          configRef.current = parsed;
          setThemeConfigState(parsed);
          applyStyleOverrides(parsed);
        } else {
          // No saved config — revert to defaults
          configRef.current = DEFAULT_THEME_CONFIG;
          setThemeConfigState(DEFAULT_THEME_CONFIG);
          removeStyleOverrides();
        }

        loadedProjectIdRef.current = currentProjectId;
      } catch (err) {
        console.error('Failed to load theme config:', err);
      } finally {
        setIsLoaded(true);
      }
    }
    load();
  }, [currentProjectId, currentProject]);

  /**
   * Update the theme config, apply it immediately, and debounce-persist.
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
    await saveThemeConfig(null);
  }, [saveThemeConfig]);

  /**
   * Update a single color in the current config (for either light or dark mode).
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
