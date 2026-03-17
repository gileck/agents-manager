/**
 * Static preset registry.
 *
 * Presets register themselves by calling `registerPreset()` at module scope.
 * Consumer code uses `getPreset()` and `getAllPresets()`.
 */

import type { ChatPreset } from './ChatPreset';

/** The preset name used when the user has not chosen one (or their choice is invalid). */
export const DEFAULT_PRESET_NAME = 'default';

const presets = new Map<string, ChatPreset>();

/** Register a preset. Throws if the name is already taken. */
export function registerPreset(preset: ChatPreset): void {
  if (presets.has(preset.name)) {
    throw new Error(`ChatPreset "${preset.name}" is already registered.`);
  }
  presets.set(preset.name, preset);
}

/** Retrieve a preset by name, falling back to the default preset. */
export function getPreset(name: string | null | undefined): ChatPreset {
  const preset = name ? presets.get(name) : undefined;
  if (preset) return preset;

  const fallback = presets.get(DEFAULT_PRESET_NAME);
  if (!fallback) {
    throw new Error('Default chat preset has not been registered.');
  }
  return fallback;
}

/** Return all registered presets (in insertion order). */
export function getAllPresets(): ChatPreset[] {
  return Array.from(presets.values());
}
