import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { reportError } from '../lib/error-handler';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@template/renderer/components/ui/card';
import { Label } from '@template/renderer/components/ui/label';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@template/renderer/components/ui/select';
import { Switch } from '@template/renderer/components/ui/switch';
import { InlineError } from '../components/InlineError';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import type { Project } from '../../shared/types';

const inputWidth = { width: '224px' };
let nextCmdId = 0;

export function ProjectConfigPage() {
  const { currentProjectId: id } = useCurrentProject();
  const navigate = useNavigate();
  const { data: project, loading, error } = useIpc<Project | null>(
    () => window.api.projects.get(id!),
    [id]
  );

  const [defaultAgentLib, setDefaultAgentLib] = useState('__default__');
  const [agentLibData, setAgentLibData] = useState<Record<string, { models: { value: string; label: string }[]; defaultModel: string }>>({});
  const [model, setModel] = useState('__default__');
  const [agentTimeout, setAgentTimeout] = useState('');
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [pullMainAfterMerge, setPullMainAfterMerge] = useState(false);
  const [validationCommands, setValidationCommands] = useState<Array<{ id: number; cmd: string }>>([]);
  const [maxValidationRetries, setMaxValidationRetries] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramStreamThinking, setTelegramStreamThinking] = useState(false);
  const [telegramAutoStart, setTelegramAutoStart] = useState(true);
  const [telegramTesting, setTelegramTesting] = useState(false);

  // Track whether we've loaded initial data (to skip auto-save on first populate)
  const initialized = useRef(false);
  const projectConfigRef = useRef<Record<string, unknown>>({});

  // Fetch supported models for all engines
  useEffect(() => {
    window.api.agentLibs.listModels().then(setAgentLibData).catch(() => {});
  }, []);

  useEffect(() => {
    if (!project) return;
    const c = project.config ?? {};
    projectConfigRef.current = c;
    initialized.current = false; // prevent auto-save during setState batch
    setDefaultAgentLib((c.defaultAgentLib as string) || '__default__');
    setModel((c.defaultAgentLibModel as string) || '__default__');
    setAgentTimeout(c.agentTimeout != null ? String(c.agentTimeout) : '');
    setMaxConcurrentAgents(c.maxConcurrentAgents != null ? String(c.maxConcurrentAgents) : '');
    setDefaultBranch((c.defaultBranch as string) ?? '');
    setPullMainAfterMerge(!!c.pullMainAfterMerge);
    setValidationCommands(
      Array.isArray(c.validationCommands)
        ? (c.validationCommands as string[]).map(cmd => ({ id: nextCmdId++, cmd }))
        : []
    );
    setMaxValidationRetries(c.maxValidationRetries != null ? String(c.maxValidationRetries) : '');
    const tg = (c.telegram as Record<string, unknown>) ?? {};
    setTelegramEnabled(!!tg.enabled);
    setTelegramBotToken((tg.botToken as string) ?? '');
    setTelegramChatId((tg.chatId as string) ?? '');
    setTelegramStreamThinking(!!tg.streamThinking);
    setTelegramAutoStart(tg.autoStart !== false);
    // Mark initialized after React processes the state batch
    requestAnimationFrame(() => { initialized.current = true; });
  }, [project]);

  const saveConfig = useCallback(async (
    fields: {
      defaultAgentLib: string; model: string; agentTimeout: string; maxConcurrentAgents: string;
      defaultBranch: string; pullMainAfterMerge: boolean;
      validationCommands: Array<{ id: number; cmd: string }>;
      maxValidationRetries: string; telegramEnabled: boolean;
      telegramBotToken: string; telegramChatId: string;
      telegramStreamThinking: boolean; telegramAutoStart: boolean;
    }
  ) => {
    if (!id) return;
    const managed: Record<string, unknown> = {
      defaultAgentLib: fields.defaultAgentLib === '__default__' ? undefined : fields.defaultAgentLib,
      defaultAgentLibModel: fields.model === '__default__' ? undefined : fields.model,
      agentTimeout: fields.agentTimeout ? Number(fields.agentTimeout) : undefined,
      maxConcurrentAgents: fields.maxConcurrentAgents ? Number(fields.maxConcurrentAgents) : undefined,
      defaultBranch: fields.defaultBranch || undefined,
      pullMainAfterMerge: fields.pullMainAfterMerge,
      validationCommands: fields.validationCommands.length > 0 ? fields.validationCommands.map(v => v.cmd) : undefined,
      maxValidationRetries: fields.maxValidationRetries ? Number(fields.maxValidationRetries) : undefined,
      telegram: {
        enabled: fields.telegramEnabled,
        botToken: fields.telegramBotToken || undefined,
        chatId: fields.telegramChatId || undefined,
        streamThinking: fields.telegramStreamThinking,
        autoStart: fields.telegramAutoStart,
      },
    };

    const config: Record<string, unknown> = { ...projectConfigRef.current };
    for (const [key, value] of Object.entries(managed)) {
      if (value === undefined) {
        delete config[key];
      } else {
        config[key] = value;
      }
    }

    try {
      await window.api.projects.update(id, { config });
      projectConfigRef.current = config;
    } catch (err) {
      reportError(err, 'Configuration save');
    }
  }, [id]);

  // Auto-save with debounce whenever any field changes
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!initialized.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveConfig({
        defaultAgentLib, model, agentTimeout, maxConcurrentAgents, defaultBranch,
        pullMainAfterMerge, validationCommands, maxValidationRetries,
        telegramEnabled, telegramBotToken, telegramChatId, telegramStreamThinking,
        telegramAutoStart,
      });
    }, 500);
    return () => clearTimeout(timerRef.current);
  }, [defaultAgentLib, model, agentTimeout, maxConcurrentAgents, defaultBranch, pullMainAfterMerge,
      validationCommands, maxValidationRetries, telegramEnabled, telegramBotToken, telegramChatId,
      telegramStreamThinking, telegramAutoStart, saveConfig]);

  const addValidationCommand = () =>
    setValidationCommands(prev => [...prev, { id: nextCmdId++, cmd: '' }]);
  const removeValidationCommand = (cmdId: number) =>
    setValidationCommands(prev => prev.filter(v => v.id !== cmdId));
  const updateValidationCommand = (cmdId: number, value: string) =>
    setValidationCommands(prev => prev.map(v => (v.id === cmdId ? { ...v, cmd: value } : v)));

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading configuration...</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-8">
        <InlineError message={error || 'Project not found'} context="Project config" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <p className="text-muted-foreground mb-6">{project.name}</p>

      <div className="max-w-2xl space-y-6">
        {/* Agent Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Agent Settings</CardTitle>
            <CardDescription>Configure AI agent behavior for this project</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="defaultAgentLib">Agent Lib</Label>
                <div style={inputWidth}>
                <Select value={defaultAgentLib} onValueChange={(v) => {
                  setDefaultAgentLib(v);
                  // Reset model to default when switching engine
                  setModel('__default__');
                }}>
                  <SelectTrigger id="defaultAgentLib">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default (claude-code)</SelectItem>
                    {Object.keys(agentLibData).map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="model">Model</Label>
                <div style={inputWidth}>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default</SelectItem>
                    {(agentLibData[defaultAgentLib === '__default__' ? 'claude-code' : defaultAgentLib]?.models ?? []).map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="agentTimeout">Agent Timeout (seconds)</Label>
                <Input
                  id="agentTimeout"
                  type="number"
                  style={inputWidth}
                  placeholder="300"
                  value={agentTimeout}
                  onChange={(e) => setAgentTimeout(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="maxConcurrentAgents">Max Concurrent Agents</Label>
                <Input
                  id="maxConcurrentAgents"
                  type="number"
                  style={inputWidth}
                  placeholder="3"
                  value={maxConcurrentAgents}
                  onChange={(e) => setMaxConcurrentAgents(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Git / SCM Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Git / SCM Settings</CardTitle>
            <CardDescription>Source control configuration for this project</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="defaultBranch">Default Branch</Label>
                <Input
                  id="defaultBranch"
                  style={inputWidth}
                  placeholder="main"
                  value={defaultBranch}
                  onChange={(e) => setDefaultBranch(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="pullMainAfterMerge">Pull Main After Merge</Label>
                <Switch
                  id="pullMainAfterMerge"
                  checked={pullMainAfterMerge}
                  onCheckedChange={setPullMainAfterMerge}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Validation Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Validation Settings</CardTitle>
            <CardDescription>Commands to validate agent work before completion</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Validation Commands</Label>
                  <Button variant="outline" size="sm" onClick={addValidationCommand}>
                    + Add
                  </Button>
                </div>
                {validationCommands.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No validation commands configured.</p>
                ) : (
                  <div className="space-y-2">
                    {validationCommands.map((v) => (
                      <div key={v.id} className="flex gap-2">
                        <Input
                          value={v.cmd}
                          placeholder="e.g. npm test"
                          onChange={(e) => updateValidationCommand(v.id, e.target.value)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeValidationCommand(v.id)}
                          className="shrink-0"
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="maxValidationRetries">Max Validation Retries</Label>
                <Input
                  id="maxValidationRetries"
                  type="number"
                  style={inputWidth}
                  placeholder="3"
                  value={maxValidationRetries}
                  onChange={(e) => setMaxValidationRetries(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Telegram Bot */}
        <Card>
          <CardHeader>
            <CardTitle>Telegram Bot</CardTitle>
            <CardDescription>Configure Telegram bot and notifications for this project</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="telegramEnabled">Enable Telegram Bot</Label>
                <Switch
                  id="telegramEnabled"
                  checked={telegramEnabled}
                  onCheckedChange={setTelegramEnabled}
                />
              </div>
              {telegramEnabled && (
                <>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="telegramBotToken">Bot Token</Label>
                    <Input
                      id="telegramBotToken"
                      type="password"
                      style={inputWidth}
                      placeholder="Bot token"
                      value={telegramBotToken}
                      onChange={(e) => setTelegramBotToken(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="telegramChatId">Chat ID</Label>
                    <Input
                      id="telegramChatId"
                      style={inputWidth}
                      placeholder="Chat ID"
                      value={telegramChatId}
                      onChange={(e) => setTelegramChatId(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="telegramStreamThinking">Stream Tool Calls</Label>
                    <Switch
                      id="telegramStreamThinking"
                      checked={telegramStreamThinking}
                      onCheckedChange={setTelegramStreamThinking}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="telegramAutoStart">Auto-start on daemon load</Label>
                    <Switch
                      id="telegramAutoStart"
                      checked={telegramAutoStart}
                      onCheckedChange={setTelegramAutoStart}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!telegramBotToken || !telegramChatId}
                      onClick={() => navigate(`/projects/${id}/telegram`)}
                    >
                      Open Telegram Bot Page
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!telegramBotToken || !telegramChatId || telegramTesting}
                      onClick={async () => {
                        setTelegramTesting(true);
                        try {
                          await window.api.telegram.test(telegramBotToken, telegramChatId);
                          toast.success('Test message sent successfully');
                        } catch (err) {
                          reportError(err, 'Telegram test');
                        } finally {
                          setTelegramTesting(false);
                        }
                      }}
                    >
                      {telegramTesting ? 'Sending...' : 'Test Notifications'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
