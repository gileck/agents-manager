import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { reportError } from '../../lib/error-handler';
import { useAutomatedAgentTemplates } from '../../hooks/useAutomatedAgents';
import type {
  AutomatedAgent,
  AutomatedAgentCreateInput,
  AutomatedAgentUpdateInput,
  AutomatedAgentSchedule,
  AutomatedAgentScheduleType,
  AutomatedAgentCapabilities,
} from '../../../shared/types';

interface AutomatedAgentDialogProps {
  projectId: string;
  agent: AutomatedAgent | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

const DEFAULT_CAPABILITIES: AutomatedAgentCapabilities = {
  canCreateTasks: false,
  canModifyTasks: false,
  readOnly: true,
  dryRun: false,
  maxActions: 50,
};

export function AutomatedAgentDialog({ projectId, agent, onClose, onSaved }: AutomatedAgentDialogProps) {
  const { templates, error: templatesError } = useAutomatedAgentTemplates();
  const isEdit = agent !== null;

  const [name, setName] = useState(agent?.name ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [promptInstructions, setPromptInstructions] = useState(agent?.promptInstructions ?? '');
  const [scheduleType, setScheduleType] = useState<AutomatedAgentScheduleType>(agent?.schedule?.type ?? 'manual');
  const [intervalValue, setIntervalValue] = useState('60');
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours' | 'days'>('minutes');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [cronExpr, setCronExpr] = useState('0 * * * *');
  const [capabilities, setCapabilities] = useState<AutomatedAgentCapabilities>(agent?.capabilities ?? DEFAULT_CAPABILITIES);
  const [maxRunDuration, setMaxRunDuration] = useState(Math.round((agent?.maxRunDurationMs ?? 600000) / 60000));
  const [templateId, setTemplateId] = useState<string>(agent?.templateId ?? '');
  const [saving, setSaving] = useState(false);

  // Initialize schedule fields from existing agent
  useEffect(() => {
    if (!agent) return;
    const s = agent.schedule;
    if (s.type === 'interval') {
      const ms = parseInt(s.value, 10);
      if (ms >= 86400000) { setIntervalValue(String(Math.round(ms / 86400000))); setIntervalUnit('days'); }
      else if (ms >= 3600000) { setIntervalValue(String(Math.round(ms / 3600000))); setIntervalUnit('hours'); }
      else { setIntervalValue(String(Math.round(ms / 60000))); setIntervalUnit('minutes'); }
    } else if (s.type === 'daily-at') {
      setDailyTime(s.value);
    } else if (s.type === 'cron') {
      setCronExpr(s.value);
    }
  }, [agent]);

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    const template = templates.find(t => t.id === id);
    if (!template) return;
    setName(template.name);
    setDescription(template.description);
    setPromptInstructions(template.promptInstructions);
    setCapabilities(template.defaultCapabilities);
    setMaxRunDuration(Math.round(template.defaultMaxRunDurationMs / 60000));
    const s = template.defaultSchedule;
    setScheduleType(s.type);
    if (s.type === 'interval') {
      const ms = parseInt(s.value, 10);
      if (ms >= 86400000) { setIntervalValue(String(Math.round(ms / 86400000))); setIntervalUnit('days'); }
      else if (ms >= 3600000) { setIntervalValue(String(Math.round(ms / 3600000))); setIntervalUnit('hours'); }
      else { setIntervalValue(String(Math.round(ms / 60000))); setIntervalUnit('minutes'); }
    } else if (s.type === 'daily-at') {
      setDailyTime(s.value);
    } else if (s.type === 'cron') {
      setCronExpr(s.value);
    }
  };

  const buildSchedule = (): AutomatedAgentSchedule => {
    switch (scheduleType) {
      case 'manual': return { type: 'manual', value: '' };
      case 'interval': {
        const num = parseInt(intervalValue, 10) || 60;
        const multiplier = intervalUnit === 'days' ? 86400000 : intervalUnit === 'hours' ? 3600000 : 60000;
        return { type: 'interval', value: String(num * multiplier) };
      }
      case 'daily-at': return { type: 'daily-at', value: dailyTime };
      case 'cron': return { type: 'cron', value: cronExpr };
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        const input: AutomatedAgentUpdateInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          promptInstructions,
          capabilities,
          schedule: buildSchedule(),
          maxRunDurationMs: maxRunDuration * 60000,
        };
        await window.api.automatedAgents.update(agent!.id, input);
        toast.success('Agent updated');
      } else {
        const input: AutomatedAgentCreateInput = {
          projectId,
          name: name.trim(),
          description: description.trim() || undefined,
          promptInstructions,
          capabilities,
          schedule: buildSchedule(),
          maxRunDurationMs: maxRunDuration * 60000,
          templateId: templateId || undefined,
        };
        await window.api.automatedAgents.create(input);
        toast.success('Agent created');
      }
      onSaved();
      onClose();
    } catch (err) {
      reportError(err, isEdit ? 'Update automated agent' : 'Create automated agent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-sm">{isEdit ? 'Edit Agent' : 'New Automated Agent'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Template picker (create only) */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium mb-1">Template</label>
              {templatesError ? (
                <p className="text-xs text-red-500">Failed to load templates: {templatesError}</p>
              ) : (
                <select
                  value={templateId}
                  onChange={e => handleTemplateChange(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background"
                >
                  <option value="">Custom (blank)</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background"
              placeholder="My Agent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background"
              placeholder="What does this agent do?"
            />
          </div>

          {/* Prompt instructions */}
          <div>
            <label className="block text-xs font-medium mb-1">Prompt Instructions</label>
            <textarea
              value={promptInstructions}
              onChange={e => setPromptInstructions(e.target.value)}
              rows={8}
              className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background font-mono"
              placeholder="Instructions for the agent..."
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-xs font-medium mb-1">Schedule</label>
            <div className="space-y-2">
              <select
                value={scheduleType}
                onChange={e => setScheduleType(e.target.value as AutomatedAgentScheduleType)}
                className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background"
              >
                <option value="manual">Manual only</option>
                <option value="interval">Interval</option>
                <option value="daily-at">Daily at time</option>
                <option value="cron">Cron expression</option>
              </select>

              {scheduleType === 'interval' && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={intervalValue}
                    onChange={e => setIntervalValue(e.target.value)}
                    min={1}
                    className="w-24 text-sm px-2 py-1.5 rounded border border-input bg-background"
                  />
                  <select
                    value={intervalUnit}
                    onChange={e => setIntervalUnit(e.target.value as 'minutes' | 'hours' | 'days')}
                    className="text-sm px-2 py-1.5 rounded border border-input bg-background"
                  >
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              )}

              {scheduleType === 'daily-at' && (
                <input
                  type="time"
                  value={dailyTime}
                  onChange={e => setDailyTime(e.target.value)}
                  className="text-sm px-2 py-1.5 rounded border border-input bg-background"
                />
              )}

              {scheduleType === 'cron' && (
                <input
                  type="text"
                  value={cronExpr}
                  onChange={e => setCronExpr(e.target.value)}
                  className="w-full text-sm px-2 py-1.5 rounded border border-input bg-background font-mono"
                  placeholder="0 * * * *"
                />
              )}
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <label className="block text-xs font-medium mb-1">Capabilities</label>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={capabilities.readOnly}
                  onChange={e => setCapabilities({ ...capabilities, readOnly: e.target.checked })}
                />
                Read only (no file modifications)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={capabilities.canCreateTasks}
                  onChange={e => setCapabilities({ ...capabilities, canCreateTasks: e.target.checked })}
                />
                Can create tasks
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={capabilities.canModifyTasks}
                  onChange={e => setCapabilities({ ...capabilities, canModifyTasks: e.target.checked })}
                />
                Can modify tasks
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={capabilities.dryRun}
                  onChange={e => setCapabilities({ ...capabilities, dryRun: e.target.checked })}
                />
                Dry run (report only, no actions)
              </label>
              <div className="flex items-center gap-2">
                <label className="text-xs">Max actions:</label>
                <input
                  type="number"
                  value={capabilities.maxActions}
                  onChange={e => setCapabilities({ ...capabilities, maxActions: parseInt(e.target.value, 10) || 50 })}
                  min={1}
                  max={200}
                  className="w-20 text-sm px-2 py-1 rounded border border-input bg-background"
                />
              </div>
            </div>
          </div>

          {/* Max run duration */}
          <div>
            <label className="block text-xs font-medium mb-1">Max Run Duration (minutes)</label>
            <input
              type="number"
              value={maxRunDuration}
              onChange={e => setMaxRunDuration(parseInt(e.target.value, 10) || 10)}
              min={1}
              max={120}
              className="w-24 text-sm px-2 py-1.5 rounded border border-input bg-background"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-input hover:bg-muted transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
