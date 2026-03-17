/**
 * Smoke tests for the chat preset registry.
 *
 * Verifies registerPreset / getPreset / getAllPresets behaviour and
 * that a preset with the claude-code shape (all 5 slots) round-trips
 * correctly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use dynamic imports after resetModules so each test gets a fresh registry Map.
describe('chat preset registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registerPreset + getPreset round-trips', async () => {
    const { registerPreset, getPreset } = await import(
      '../../src/renderer/components/chat/presets/registry'
    );
    const mockPanel = (() => null) as unknown as React.ComponentType;
    registerPreset({ name: 'default', label: 'Default', ChatPanel: mockPanel });
    registerPreset({ name: 'my-preset', label: 'My', ChatPanel: mockPanel });

    const result = getPreset('my-preset');
    expect(result.name).toBe('my-preset');
    expect(result.label).toBe('My');
    expect(result.ChatPanel).toBe(mockPanel);
  });

  it('getPreset falls back to default for unknown / null / undefined name', async () => {
    const { registerPreset, getPreset } = await import(
      '../../src/renderer/components/chat/presets/registry'
    );
    const defaultPreset = {
      name: 'default',
      label: 'Default',
      ChatPanel: (() => null) as unknown as React.ComponentType,
    };
    registerPreset(defaultPreset);

    expect(getPreset('nonexistent')).toBe(defaultPreset);
    expect(getPreset(null)).toBe(defaultPreset);
    expect(getPreset(undefined)).toBe(defaultPreset);
  });

  it('registerPreset throws on duplicate name', async () => {
    const { registerPreset } = await import(
      '../../src/renderer/components/chat/presets/registry'
    );
    const mock = (() => null) as unknown as React.ComponentType;
    registerPreset({ name: 'dup', label: 'Dup', ChatPanel: mock });

    expect(() =>
      registerPreset({ name: 'dup', label: 'Dup2', ChatPanel: mock }),
    ).toThrow('already registered');
  });

  it('getPreset throws when no default has been registered', async () => {
    const { getPreset } = await import(
      '../../src/renderer/components/chat/presets/registry'
    );
    expect(() => getPreset(null)).toThrow('Default chat preset has not been registered');
  });

  it('getAllPresets returns all registered presets in insertion order', async () => {
    const { registerPreset, getAllPresets } = await import(
      '../../src/renderer/components/chat/presets/registry'
    );
    const mock = (() => null) as unknown as React.ComponentType;
    registerPreset({ name: 'default', label: 'Default', ChatPanel: mock });
    registerPreset({ name: 'second', label: 'Second', ChatPanel: mock });

    const all = getAllPresets();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.name)).toEqual(['default', 'second']);
  });

  it('claude-code preset shape with all 5 slots registers and retrieves correctly', async () => {
    const { registerPreset, getPreset } = await import(
      '../../src/renderer/components/chat/presets/registry'
    );
    const mock = (() => null) as unknown as React.ComponentType;

    // Register default (required for fallback)
    registerPreset({ name: 'default', label: 'Default', ChatPanel: mock });

    // Register a preset matching the claude-code contract (all 5 slots populated)
    const ccPreset = {
      name: 'claude-code',
      label: 'Claude Code',
      ChatPanel: mock,
      ChatMessageList: mock,
      ChatInput: mock,
      AgentBlock: mock,
      SessionTabs: mock,
    };
    registerPreset(ccPreset);

    const result = getPreset('claude-code');
    expect(result).toBe(ccPreset);
    expect(result.name).toBe('claude-code');
    expect(result.label).toBe('Claude Code');
    expect(result.ChatPanel).toBeDefined();
    expect(result.ChatMessageList).toBeDefined();
    expect(result.ChatInput).toBeDefined();
    expect(result.AgentBlock).toBeDefined();
    expect(result.SessionTabs).toBeDefined();
  });
});
