import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { reportError } from '../../lib/error-handler';
import type {
  AutomatedAgent,
  AutomatedAgentCreateInput,
  AutomatedAgentUpdateInput,
  AutomatedAgentSchedule,
  AutomatedAgentScheduleType,
  AutomatedAgentCapabilities,
  AutomatedAgentTemplate,
} from '../../../shared/types';

interface AutomatedAgentDialogProps {
  projectId: string;
  agent: AutomatedAgent | null; // null = create mode
  template?: AutomatedAgentTemplate | null;
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

function initScheduleFields(s: AutomatedAgentSchedule) {
  let intervalValue = '60';
  let intervalUnit: 'minutes' | 'hours' | 'days' = 'minutes';
  let dailyTime = '09:00';
  let cronExpr = '0 * * * *';

  if (s.type === 'interval') {
    const ms = parseInt(s.value, 10);
    if (ms >= 86400000) { intervalValue = String(Math.round(ms / 86400000)); intervalUnit = 'days'; }
    else if (ms >= 3600000) { intervalValue = String(Math.round(ms / 3600000)); intervalUnit = 'hours'; }
    else { intervalValue = String(Math.round(ms / 60000)); intervalUnit = 'minutes'; }
  } else if (s.type === 'daily-at') {
    dailyTime = s.value;
  } else if (s.type === 'cron') {
    cronExpr = s.value;
  }

  return { intervalValue, intervalUnit, dailyTime, cronExpr };
}

export function AutomatedAgentDialog({ projectId, agent, template, onClose, onSaved }: AutomatedAgentDialogProps) {
  const isEdit = agent !== null;

  // Resolve initial values from agent (edit) or template (create from template) or defaults (create blank)
  const source = agent ?? template;
  const initialSchedule = source
    ? ('schedule' in source ? source.schedule : source.defaultSchedule)
    : { type: 'manual' as const, value: '' };
  const initialCaps = source
    ? ('capabilities' in source ? source.capabilities : source.defaultCapabilities)
    : DEFAULT_CAPABILITIES;
  const initialMaxDuration = source
    ? ('maxRunDurationMs' in source ? source.maxRunDurationMs : source.defaultMaxRunDurationMs)
    : 600000;
  const initialScheduleFields = initScheduleFields(initialSchedule);

  const [name, setName] = useState(source?.name ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [promptInstructions, setPromptInstructions] = useState(source?.promptInstructions ?? '');
  const [scheduleType, setScheduleType] = useState<AutomatedAgentScheduleType>(initialSchedule.type);
  const [intervalValue, setIntervalValue] = useState(initialScheduleFields.intervalValue);
  const [intervalUnit, setIntervalUnit] = useState(initialScheduleFields.intervalUnit);
  const [dailyTime, setDailyTime] = useState(initialScheduleFields.dailyTime);
  const [cronExpr, setCronExpr] = useState(initialScheduleFields.cronExpr);
  const [capabilities, setCapabilities] = useState<AutomatedAgentCapabilities>(initialCaps);
  const [maxRunDuration, setMaxRunDuration] = useState(Math.round(initialMaxDuration / 60000));
  const [saving, setSaving] = useState(false);

  // Re-init schedule fields when editing an existing agent
  useEffect(() => {
    if (!agent) return;
    const fields = initScheduleFields(agent.schedule);
    setIntervalValue(fields.intervalValue);
    setIntervalUnit(fields.intervalUnit);
    setDailyTime(fields.dailyTime);
    setCronExpr(fields.cronExpr);
  }, [agent]);

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
          templateId: template?.id,
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
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-sm">{isEdit ? 'Edit Agent' : 'New Automated Agent'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Name & Description row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded border border-input bg-background"
                placeholder="My Agent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Description</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded border border-input bg-background"
                placeholder="What does this agent do?"
              />
            </div>
          </div>

          {/* Prompt instructions — large */}
          <div>
            <label className="block text-xs font-medium mb-1">Prompt Instructions</label>
            <textarea
              value={promptInstructions}
              onChange={e => setPromptInstructions(e.target.value)}
              rows={14}
              className="w-full text-sm px-3 py-2 rounded border border-input bg-background font-mono resize-y"
              placeholder="Instructions for the agent..."
            />
          </div>

          {/* Schedule & Duration row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Schedule</label>
              <div className="space-y-2">
                <select
                  value={scheduleType}
                  onChange={e => setScheduleType(e.target.value as AutomatedAgentScheduleType)}
                  className="w-full text-sm px-3 py-2 rounded border border-input bg-background"
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
                      className="w-24 text-sm px-3 py-2 rounded border border-input bg-background"
                    />
                    <select
                      value={intervalUnit}
                      onChange={e => setIntervalUnit(e.target.value as 'minutes' | 'hours' | 'days')}
                      className="text-sm px-3 py-2 rounded border border-input bg-background"
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
                    className="text-sm px-3 py-2 rounded border border-input bg-background"
                  />
                )}

                {scheduleType === 'cron' && (
                  <input
                    type="text"
                    value={cronExpr}
                    onChange={e => setCronExpr(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded border border-input bg-background font-mono"
                    placeholder="0 * * * *"
                  />
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Max Run Duration (minutes)</label>
              <input
                type="number"
                value={maxRunDuration}
                onChange={e => setMaxRunDuration(parseInt(e.target.value, 10) || 10)}
                min={1}
                max={120}
                className="w-24 text-sm px-3 py-2 rounded border border-input bg-background"
              />
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <label className="block text-xs font-medium mb-1">Capabilities</label>
            <div className="flex flex-wrap gap-x-6 gap-y-1.5">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={capabilities.readOnly}
                  onChange={e => setCapabilities({ ...capabilities, readOnly: e.target.checked })}
                />
                Read only
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={capabilities.canCreateTasks}
                  onChange={e => setCapabilities({ ...capabilities, canCreateTasks: e.target.checked })}
                />
                Create tasks
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={capabilities.canModifyTasks}
                  onChange={e => setCapabilities({ ...capabilities, canModifyTasks: e.target.checked })}
                />
                Modify tasks
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={capabilities.dryRun}
                  onChange={e => setCapabilities({ ...capabilities, dryRun: e.target.checked })}
                />
                Dry run
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
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-input hover:bg-muted transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
