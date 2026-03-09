import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import type { Pipeline, Feature, TaskType, TaskSize, TaskComplexity } from '../../../shared/types';

export type TagsMode = 'replace' | 'add' | 'remove';

export interface BatchEditState {
  priority:   { enabled: boolean; value: number };
  assignee:   { enabled: boolean; value: string };
  tags:       { enabled: boolean; mode: TagsMode; values: string[] };
  featureId:  { enabled: boolean; value: string };
  pipelineId: { enabled: boolean; value: string };
  type:       { enabled: boolean; value: TaskType };
  size:       { enabled: boolean; value: TaskSize | '' };
  complexity: { enabled: boolean; value: TaskComplexity | '' };
}

interface TaskBatchEditDialogProps {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  pipelines: Pipeline[];
  features: Feature[];
  existingTags: string[];
  onApply: (state: BatchEditState) => Promise<void>;
  applying?: boolean;
}

const PRIORITY_OPTIONS = [
  { value: 0, label: 'Critical (P0)' },
  { value: 1, label: 'High (P1)' },
  { value: 2, label: 'Medium (P2)' },
  { value: 3, label: 'Low (P3)' },
];

function FieldRow({
  enabled,
  onToggle,
  label,
  children,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={enabled}
        onChange={onToggle}
        className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer flex-shrink-0"
        id={`batch-field-${label}`}
      />
      <label
        htmlFor={`batch-field-${label}`}
        className="text-sm font-medium w-24 flex-shrink-0 cursor-pointer select-none"
      >
        {label}
      </label>
      <div className={`flex-1 ${!enabled ? 'opacity-40 pointer-events-none' : ''}`}>
        {children}
      </div>
    </div>
  );
}

const DEFAULT_STATE: BatchEditState = {
  priority:   { enabled: false, value: 2 },
  assignee:   { enabled: false, value: '' },
  tags:       { enabled: false, mode: 'replace', values: [] },
  featureId:  { enabled: false, value: '' },
  pipelineId: { enabled: false, value: '' },
  type:       { enabled: false, value: 'feature' },
  size:       { enabled: false, value: '' },
  complexity: { enabled: false, value: '' },
};

export function TaskBatchEditDialog({
  open,
  onClose,
  selectedCount,
  pipelines,
  features,
  existingTags,
  onApply,
  applying,
}: TaskBatchEditDialogProps) {
  const [state, setState] = useState<BatchEditState>(DEFAULT_STATE);

  const toggle = (field: keyof BatchEditState) => {
    setState((prev) => ({
      ...prev,
      [field]: { ...prev[field], enabled: !prev[field].enabled },
    }));
  };

  const set = <K extends keyof BatchEditState>(
    field: K,
    patch: Partial<BatchEditState[K]>,
  ) => {
    setState((prev) => ({ ...prev, [field]: { ...prev[field], ...patch } }));
  };

  const anyEnabled = Object.values(state).some((f) => f.enabled);

  const handleClose = () => {
    setState(DEFAULT_STATE);
    onClose();
  };

  const handleApply = async () => {
    await onApply(state);
    setState(DEFAULT_STATE);
  };

  // Tag input: comma-separated string ↔ string[]
  const tagsRaw = state.tags.values.join(', ');

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {selectedCount} task{selectedCount !== 1 ? 's' : ''}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1 mb-2">
          Enable fields you want to update. Disabled fields are left unchanged.
        </p>

        <div className="space-y-3 py-2">
          {/* Priority */}
          <FieldRow enabled={state.priority.enabled} onToggle={() => toggle('priority')} label="Priority">
            <Select
              value={String(state.priority.value)}
              onValueChange={(v) => set('priority', { value: Number(v) })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          {/* Assignee */}
          <FieldRow enabled={state.assignee.enabled} onToggle={() => toggle('assignee')} label="Assignee">
            <Input
              className="h-8"
              placeholder="Leave blank to clear"
              value={state.assignee.value}
              onChange={(e) => set('assignee', { value: e.target.value })}
            />
          </FieldRow>

          {/* Tags */}
          <FieldRow enabled={state.tags.enabled} onToggle={() => toggle('tags')} label="Tags">
            <div className="flex gap-2">
              <Select
                value={state.tags.mode}
                onValueChange={(v) => set('tags', { mode: v as TagsMode })}
              >
                <SelectTrigger className="h-8 w-28 flex-shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replace">Replace</SelectItem>
                  <SelectItem value="add">Add</SelectItem>
                  <SelectItem value="remove">Remove</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-8 flex-1"
                placeholder="Comma-separated tags"
                value={tagsRaw}
                onChange={(e) =>
                  set('tags', {
                    values: e.target.value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            {existingTags.length > 0 && state.tags.enabled && (
              <p className="text-xs text-muted-foreground mt-1">
                Tags in selection: {existingTags.join(', ')}
              </p>
            )}
          </FieldRow>

          {/* Pipeline */}
          {pipelines.length > 0 && (
            <FieldRow enabled={state.pipelineId.enabled} onToggle={() => toggle('pipelineId')} label="Pipeline">
              <Select
                value={state.pipelineId.value}
                onValueChange={(v) => set('pipelineId', { value: v })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}

          {/* Feature */}
          {features.length > 0 && (
            <FieldRow enabled={state.featureId.enabled} onToggle={() => toggle('featureId')} label="Feature">
              <Select
                value={state.featureId.value || '__none__'}
                onValueChange={(v) => set('featureId', { value: v === '__none__' ? '' : v })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="No feature" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No feature</SelectItem>
                  {features.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}

          {/* Type */}
          <FieldRow enabled={state.type.enabled} onToggle={() => toggle('type')} label="Type">
            <Select
              value={state.type.value}
              onValueChange={(v) => set('type', { value: v as TaskType })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feature">Feature</SelectItem>
                <SelectItem value="bug">Bug</SelectItem>
                <SelectItem value="improvement">Improvement</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          {/* Size */}
          <FieldRow enabled={state.size.enabled} onToggle={() => toggle('size')} label="Size">
            <Select
              value={state.size.value || '__none__'}
              onValueChange={(v) => set('size', { value: v === '__none__' ? '' : v as TaskSize })}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                <SelectItem value="xs">XS</SelectItem>
                <SelectItem value="sm">SM</SelectItem>
                <SelectItem value="md">MD</SelectItem>
                <SelectItem value="lg">LG</SelectItem>
                <SelectItem value="xl">XL</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          {/* Complexity */}
          <FieldRow enabled={state.complexity.enabled} onToggle={() => toggle('complexity')} label="Complexity">
            <Select
              value={state.complexity.value || '__none__'}
              onValueChange={(v) => set('complexity', { value: v === '__none__' ? '' : v as TaskComplexity })}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select complexity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!anyEnabled || applying}>
            {applying ? 'Applying...' : `Apply to ${selectedCount} task${selectedCount !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
