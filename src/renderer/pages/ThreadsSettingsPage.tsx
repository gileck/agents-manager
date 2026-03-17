import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { reportError } from '../lib/error-handler';
import type { AppSettings, ChatThreadTheme, PermissionMode } from '../../shared/types';
import { getAllPresets } from '../components/chat/presets/registry';
// Ensure presets are registered before we call getAllPresets().
import '../components/chat/presets/default';
import '../components/chat/presets/claude-code';

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'read_only', label: 'Read Only', description: 'Agent can only read files' },
  { value: 'read_write', label: 'Read & Write', description: 'Agent can read and write files' },
  { value: 'full_access', label: 'Full Access', description: 'Agent has full system access' },
];

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_BG_COLOR = '';

function parseThreadTheme(raw: string | null): ChatThreadTheme {
  if (!raw) return { fontSize: DEFAULT_FONT_SIZE, backgroundColor: DEFAULT_BG_COLOR };
  try {
    const parsed = JSON.parse(raw) as Partial<ChatThreadTheme>;
    return {
      fontSize: typeof parsed.fontSize === 'number' ? parsed.fontSize : DEFAULT_FONT_SIZE,
      backgroundColor: typeof parsed.backgroundColor === 'string' ? parsed.backgroundColor : DEFAULT_BG_COLOR,
    };
  } catch {
    return { fontSize: DEFAULT_FONT_SIZE, backgroundColor: DEFAULT_BG_COLOR };
  }
}

export function ThreadsSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [agentLibs, setAgentLibs] = useState<{ name: string; available: boolean }[]>([]);
  const [agentLibModels, setAgentLibModels] = useState<Record<string, { models: { value: string; label: string }[]; defaultModel: string }>>({});
  const [threadTheme, setThreadTheme] = useState<ChatThreadTheme>({ fontSize: DEFAULT_FONT_SIZE, backgroundColor: DEFAULT_BG_COLOR });

  // Ref for debounced theme saves
  const themeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s);
      setThreadTheme(parseThreadTheme(s.chatThreadTheme));
    }).catch((err) => reportError(err, 'Load settings'));
    window.api.agentLibs.list().then(setAgentLibs).catch((err) => reportError(err, 'Load agent libs'));
    window.api.agentLibs.listModels().then(setAgentLibModels).catch((err) => reportError(err, 'Load agent lib models'));
  }, []);

  // ── Default Chat Config handlers ─────────────────────────────────────────

  const handleAgentLibChange = async (value: string) => {
    try {
      const updated = await window.api.settings.update({ chatDefaultAgentLib: value });
      setSettings(updated);
    } catch (err) {
      reportError(err, 'Update default agent lib');
    }
  };

  const handleModelChange = async (value: string) => {
    try {
      const updated = await window.api.settings.update({ chatDefaultModel: value || null });
      setSettings(updated);
    } catch (err) {
      reportError(err, 'Update default model');
    }
  };

  const handlePermissionModeChange = async (value: PermissionMode) => {
    try {
      const updated = await window.api.settings.update({ chatDefaultPermissionMode: value });
      setSettings(updated);
    } catch (err) {
      reportError(err, 'Update default permission mode');
    }
  };

  // ── Chat Preset handler ────────────────────────────────────────────────────

  const handlePresetChange = async (value: string) => {
    try {
      const updated = await window.api.settings.update({ chatPreset: value || null });
      setSettings(updated);
    } catch (err) {
      reportError(err, 'Update chat preset');
    }
  };

  // ── Thread Theme handlers ─────────────────────────────────────────────────

  const saveTheme = useCallback((theme: ChatThreadTheme) => {
    if (themeDebounceRef.current) clearTimeout(themeDebounceRef.current);
    themeDebounceRef.current = setTimeout(async () => {
      try {
        await window.api.settings.update({ chatThreadTheme: JSON.stringify(theme) });
      } catch (err) {
        reportError(err, 'Save thread theme');
      }
    }, 300);
  }, []);

  const handleFontSizeChange = (value: number) => {
    const next = { ...threadTheme, fontSize: value };
    setThreadTheme(next);
    saveTheme(next);
  };

  const handleBgColorChange = (value: string) => {
    const next = { ...threadTheme, backgroundColor: value };
    setThreadTheme(next);
    saveTheme(next);
  };

  const handleResetTheme = async () => {
    const defaultTheme: ChatThreadTheme = { fontSize: DEFAULT_FONT_SIZE, backgroundColor: DEFAULT_BG_COLOR };
    setThreadTheme(defaultTheme);
    try {
      await window.api.settings.update({ chatThreadTheme: null });
    } catch (err) {
      reportError(err, 'Reset thread theme');
    }
  };

  if (!settings) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  const selectedAgentLib = settings.chatDefaultAgentLib || 'claude-code';
  const modelsForLib = agentLibModels[selectedAgentLib]?.models ?? [];
  const presets = getAllPresets();

  return (
    <div className="p-8">
      <div className="max-w-2xl">
        <div className="space-y-6">

          {/* ── Default Chat Configuration ─────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Default Chat Configuration</CardTitle>
              <CardDescription>
                Global defaults applied to new chat sessions when no per-session override is set
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Chat UI Preset */}
              {presets.length > 1 && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="chatPreset">Chat UI Preset</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Visual style for the chat interface
                    </p>
                  </div>
                  <Select
                    value={settings.chatPreset || 'default'}
                    onValueChange={handlePresetChange}
                  >
                    <SelectTrigger id="chatPreset" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((p) => (
                        <SelectItem key={p.name} value={p.name}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Default Agent Lib */}
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="chatDefaultAgentLib">Default Agent Engine</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The AI engine used for new chat sessions
                  </p>
                </div>
                <Select
                  value={settings.chatDefaultAgentLib || 'claude-code'}
                  onValueChange={handleAgentLibChange}
                >
                  <SelectTrigger id="chatDefaultAgentLib" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {agentLibs.map((lib) => (
                      <SelectItem key={lib.name} value={lib.name}>
                        {lib.name}{!lib.available ? ' (unavailable)' : ''}
                      </SelectItem>
                    ))}
                    {agentLibs.length === 0 && (
                      <SelectItem value="claude-code">claude-code</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Default Model */}
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="chatDefaultModel">Default Model</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    The model used for new chat sessions (engine default if unset)
                  </p>
                </div>
                <Select
                  value={settings.chatDefaultModel || '__default__'}
                  onValueChange={(v) => handleModelChange(v === '__default__' ? '' : v)}
                >
                  <SelectTrigger id="chatDefaultModel" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Engine default</SelectItem>
                    {modelsForLib.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Default Permission Mode */}
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="chatDefaultPermissionMode">Default Permission Mode</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Access level granted to the agent in new sessions
                  </p>
                </div>
                <Select
                  value={settings.chatDefaultPermissionMode || 'full_access'}
                  onValueChange={(v) => handlePermissionModeChange(v as PermissionMode)}
                >
                  <SelectTrigger id="chatDefaultPermissionMode" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERMISSION_MODE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

            </CardContent>
          </Card>

          {/* ── Thread Theme Customizations ───────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Thread Theme</CardTitle>
              <CardDescription>
                Visual customizations for the chat message area
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Font Size */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Font Size</Label>
                  <span className="text-sm font-mono text-muted-foreground">{threadTheme.fontSize}px</span>
                </div>
                <input
                  type="range"
                  min={11}
                  max={22}
                  step={1}
                  value={threadTheme.fontSize}
                  onChange={(e) => handleFontSizeChange(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>11px</span>
                  <span>22px</span>
                </div>
              </div>

              {/* Background Color */}
              <div className="flex items-center justify-between">
                <div>
                  <Label>Background Color</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Override the chat area background (leave empty to use theme default)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={threadTheme.backgroundColor || '#ffffff'}
                    onChange={(e) => handleBgColorChange(e.target.value)}
                    className="w-10 h-9 rounded border border-border cursor-pointer bg-transparent p-0.5"
                    title="Pick background color"
                  />
                  {threadTheme.backgroundColor && (
                    <button
                      onClick={() => handleBgColorChange('')}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      title="Clear background color"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Reset */}
              <div className="pt-1 border-t border-border/60">
                <button
                  onClick={handleResetTheme}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Reset to defaults
                </button>
              </div>

            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
