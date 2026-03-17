/**
 * PresetSelector — dropdown for choosing the active chat preset.
 *
 * Reads from the registry and persists the selection via the settings API.
 * Hidden when only one preset is registered.
 */

import React, { useCallback } from 'react';
import { getAllPresets } from './registry';
import { reportError } from '../../../lib/error-handler';

export function PresetSelector() {
  const presets = getAllPresets();

  // Hide when there is only one preset — no choice to make.
  if (presets.length <= 1) {
    return null;
  }

  const handleChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    try {
      await window.api.settings.update({ chatPreset: e.target.value || null });
    } catch (err) {
      reportError(err, 'PresetSelector: update chatPreset');
    }
  }, []);

  return (
    <select
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
