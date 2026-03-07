import { describe, it, expect } from 'vitest';
import { THEME_PRESETS, COLOR_VAR_MAP } from '../../src/renderer/theme-presets';

describe('theme preset integrity', () => {
  const colorKeys = Object.keys(COLOR_VAR_MAP) as Array<keyof typeof COLOR_VAR_MAP>;

  it('ensures every preset defines every light and dark token key', () => {
    for (const preset of THEME_PRESETS) {
      for (const key of colorKeys) {
        expect(typeof preset.colors[key]).toBe('string');
        expect(preset.colors[key].length).toBeGreaterThan(0);
        expect(typeof preset.darkColors[key]).toBe('string');
        expect(preset.darkColors[key].length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the codex-inspired preset as the default first preset', () => {
    expect(THEME_PRESETS[0].name).toBe('Codex Inspired');
  });
});
