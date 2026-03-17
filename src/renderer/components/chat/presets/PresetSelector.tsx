/**
 * PresetSelector — dropdown for choosing the active chat preset.
 *
 * Reads from the registry and persists the selection via the settings API.
 * Hidden when only one preset is registered.
 */

import React, { useCallback } from 'react';
import { getAllPresets } from './registry';
import { usePreset } from './ChatPresetContext';

export function PresetSelector() {
  const presets = getAllPresets();
  const { presetName, setPreset } = usePreset();

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setPreset(e.target.value);
  }, [setPreset]);

  // Hide when there is only one preset — no choice to make.
  if (presets.length <= 1) {
    return null;
  }

  return (
    <select
      value={presetName}
      onChange={handleChange}
      className="text-xs bg-card/65 border border-border/70 rounded-full px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Chat preset"
    >
      {presets.map((p) => (
        <option key={p.name} value={p.name}>
          {p.label}
        </option>
      ))}
    </select>
  );
}
