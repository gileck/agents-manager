import React, { useState, useEffect } from 'react';
import type { AgentDefinition, AgentDefinitionCreateInput, AgentDefinitionUpdateInput, AgentModeConfig } from '../../../shared/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Badge } from '../ui/badge';
import { Plus, X } from 'lucide-react';

interface AgentDefinitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition?: AgentDefinition | null;
  onSave: (input: AgentDefinitionCreateInput | AgentDefinitionUpdateInput, id?: string) => Promise<void>;
}

const EMPTY_MODE: AgentModeConfig = { mode: '', promptTemplate: '' };

const MODELS_BY_ENGINE: Record<string, { value: string; label: string }[]> = {
  'claude-code': [
    { value: 'claude-opus-4-6-20250610', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6-20250514', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
};

export function AgentDefinitionDialog({ open, onOpenChange, definition, onSave }: AgentDefinitionDialogProps) {
  const isEdit = !!definition;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [engine, setEngine] = useState('claude-code');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [timeout, setTimeout_] = useState('');
  const [modes, setModes] = useState<AgentModeConfig[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      if (definition) {
        setName(definition.name);
        setDescription(definition.description ?? '');
        setEngine(definition.engine);
        setModel(definition.model ?? '');
        setSystemPrompt(definition.systemPrompt ?? '');
        setTimeout_(definition.timeout ? String(definition.timeout) : '');
        setSkills([...definition.skills]);
        setSkillInput('');
        setModes(definition.modes.length > 0 ? [...definition.modes] : [{ ...EMPTY_MODE }]);
      } else {
        setName('');
        setDescription('');
        setEngine('claude-code');
        setModel('');
        setSystemPrompt('');
        setTimeout_('');
        setSkills([]);
        setSkillInput('');
        setModes([{ ...EMPTY_MODE }]);
      }
    }
  }, [open, definition]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const filteredModes = modes.filter(m => m.mode.trim() && m.promptTemplate.trim());
      if (isEdit && definition) {
        const input: AgentDefinitionUpdateInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          engine,
          model: model.trim() || null,
          modes: filteredModes,
          systemPrompt: systemPrompt.trim() || null,
          timeout: timeout ? Number(timeout) : null,
          skills,
        };
        await onSave(input, definition.id);
      } else {
        const input: AgentDefinitionCreateInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          engine,
          model: model.trim() || undefined,
          modes: filteredModes,
          systemPrompt: systemPrompt.trim() || undefined,
          timeout: timeout ? Number(timeout) : undefined,
          skills: skills.length > 0 ? skills : undefined,
        };
        await onSave(input);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent definition');
    } finally {
      setSaving(false);
    }
  };

  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (trimmed && !skills.includes(trimmed) && /^[\w:.-]+$/.test(trimmed)) {
      setSkills([...skills, trimmed]);
    }
    setSkillInput('');
  };

  const removeSkill = (skill: string) => {
    setSkills(skills.filter(s => s !== skill));
  };

  const addMode = () => setModes([...modes, { ...EMPTY_MODE }]);
  const removeMode = (index: number) => setModes(modes.filter((_, i) => i !== index));
  const updateMode = (index: number, field: keyof AgentModeConfig, value: string | number | undefined) => {
    const updated = [...modes];
    updated[index] = { ...updated[index], [field]: value };
    setModes(updated);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Agent' : 'New Agent'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this agent does" />
          </div>

          <div className="space-y-2">
            <Label>Engine</Label>
            <Select value={engine} onValueChange={setEngine}>
              <SelectTrigger>
                <SelectValue placeholder="Select engine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-code">claude-code</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Model Override (optional)</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue placeholder="Default (project setting)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Default (project setting)</SelectItem>
                {(MODELS_BY_ENGINE[engine] ?? []).map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>System Prompt (optional)</Label>
            <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="Custom system prompt" rows={3} />
          </div>

          <div className="space-y-2">
            <Label>Timeout (ms, optional)</Label>
            <Input value={timeout} onChange={(e) => setTimeout_(e.target.value)} placeholder="600000" type="number" />
          </div>

          <div className="space-y-2">
            <Label>Skills (optional)</Label>
            <div className="flex gap-2">
              <Input
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSkill();
                  }
                }}
                placeholder="e.g. pr-review-toolkit:review-pr"
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={addSkill} disabled={!skillInput.trim()}>
                Add
              </Button>
            </div>
            {skills.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mt-1">
                {skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs gap-1">
                    /{skill}
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Modes</Label>
              <Button variant="outline" size="sm" onClick={addMode}>
                <Plus className="h-3 w-3 mr-1" /> Add Mode
              </Button>
            </div>
            {modes.map((m, i) => (
              <div key={i} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Input
                    value={m.mode}
                    onChange={(e) => updateMode(i, 'mode', e.target.value)}
                    placeholder="e.g. plan, implement, review"
                    className="flex-1 mr-2"
                  />
                  {modes.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeMode(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <Textarea
                  value={m.promptTemplate}
                  onChange={(e) => updateMode(i, 'promptTemplate', e.target.value)}
                  placeholder="Prompt template. Use {taskTitle}, {taskDescription}, {subtasksSection}, {planSection}, {priorReviewSection}"
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : isEdit ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
