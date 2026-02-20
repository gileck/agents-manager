import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@template/renderer/components/ui/card';
import { Label } from '@template/renderer/components/ui/label';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@template/renderer/components/ui/select';
import { Switch } from '@template/renderer/components/ui/switch';
import { useIpc } from '@template/renderer/hooks/useIpc';
import type { Project } from '../../shared/types';

const MODEL_OPTIONS = [
  { label: 'Default', value: '__default__' },
  { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
  { label: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
  { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
];

export function ProjectConfigPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, loading, error, refetch } = useIpc<Project | null>(
    () => window.api.projects.get(id!),
    [id]
  );

  const [model, setModel] = useState('__default__');
  const [agentTimeout, setAgentTimeout] = useState('');
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [pullMainAfterMerge, setPullMainAfterMerge] = useState(false);
  const [validationCommands, setValidationCommands] = useState<string[]>([]);
  const [maxValidationRetries, setMaxValidationRetries] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!project) return;
    const c = project.config ?? {};
    setModel((c.model as string) || '__default__');
    setAgentTimeout(c.agentTimeout != null ? String(c.agentTimeout) : '');
    setMaxConcurrentAgents(c.maxConcurrentAgents != null ? String(c.maxConcurrentAgents) : '');
    setDefaultBranch((c.defaultBranch as string) ?? '');
    setPullMainAfterMerge(!!c.pullMainAfterMerge);
    setValidationCommands(Array.isArray(c.validationCommands) ? (c.validationCommands as string[]) : []);
    setMaxValidationRetries(c.maxValidationRetries != null ? String(c.maxValidationRetries) : '');
    const tg = (c.telegram as Record<string, unknown>) ?? {};
    setTelegramBotToken((tg.botToken as string) ?? '');
    setTelegramChatId((tg.chatId as string) ?? '');
  }, [project]);

  const handleSave = async () => {
    if (!id || !project) return;
    setSaving(true);
    try {
      const managed: Record<string, unknown> = {
        model: model === '__default__' ? undefined : model,
        agentTimeout: agentTimeout ? Number(agentTimeout) : undefined,
        maxConcurrentAgents: maxConcurrentAgents ? Number(maxConcurrentAgents) : undefined,
        defaultBranch: defaultBranch || undefined,
        pullMainAfterMerge,
        validationCommands: validationCommands.length > 0 ? validationCommands : undefined,
        maxValidationRetries: maxValidationRetries ? Number(maxValidationRetries) : undefined,
        telegram: (telegramBotToken || telegramChatId)
          ? { botToken: telegramBotToken || undefined, chatId: telegramChatId || undefined }
          : undefined,
      };

      // Spread existing config first, then overlay managed fields (strip undefined)
      const config: Record<string, unknown> = { ...project.config };
      for (const [key, value] of Object.entries(managed)) {
        if (value === undefined) {
          delete config[key];
        } else {
          config[key] = value;
        }
      }

      await window.api.projects.update(id, { config });
      await refetch();
      toast.success('Configuration saved');
    } catch {
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const addValidationCommand = () => setValidationCommands([...validationCommands, '']);
  const removeValidationCommand = (index: number) =>
    setValidationCommands(validationCommands.filter((_, i) => i !== index));
  const updateValidationCommand = (index: number, value: string) =>
    setValidationCommands(validationCommands.map((cmd, i) => (i === index ? value : cmd)));

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
        <p className="text-destructive">{error || 'Project not found'}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(`/projects/${id}`)}>
        &larr; Back to project
      </Button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Configuration</h1>
          <p className="text-muted-foreground mt-1">{project.name}</p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

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
                <Label htmlFor="model">Model</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="model" className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="agentTimeout">Agent Timeout (seconds)</Label>
                <Input
                  id="agentTimeout"
                  type="number"
                  className="w-56"
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
                  className="w-56"
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
                  className="w-56"
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
                    {validationCommands.map((cmd, i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          value={cmd}
                          placeholder="e.g. npm test"
                          onChange={(e) => updateValidationCommand(i, e.target.value)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeValidationCommand(i)}
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
                  className="w-56"
                  placeholder="3"
                  value={maxValidationRetries}
                  onChange={(e) => setMaxValidationRetries(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Configure Telegram notifications for this project</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="telegramBotToken">Telegram Bot Token</Label>
                <Input
                  id="telegramBotToken"
                  className="w-56"
                  placeholder="Bot token"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="telegramChatId">Telegram Chat ID</Label>
                <Input
                  id="telegramChatId"
                  className="w-56"
                  placeholder="Chat ID"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
