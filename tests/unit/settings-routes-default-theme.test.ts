import { describe, it, expect } from 'vitest';
import { readCurrentSettings } from '../../src/daemon/routes/settings';

function makeServices(values: Record<string, string>) {
  return {
    settingsStore: {
      get: (key: string, defaultValue = '') => values[key] ?? defaultValue,
    },
  } as unknown as Parameters<typeof readCurrentSettings>[0];
}

describe('settings default theme', () => {
  it('defaults theme to dark when no theme is stored', () => {
    const settings = readCurrentSettings(makeServices({}));
    expect(settings.theme).toBe('dark');
  });

  it('keeps an explicitly stored theme value', () => {
    const settings = readCurrentSettings(makeServices({ theme: 'light' }));
    expect(settings.theme).toBe('light');
  });
});
