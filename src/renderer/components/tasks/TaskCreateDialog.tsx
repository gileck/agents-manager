import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import type { Pipeline, Feature, TaskCreateInput } from '../../../shared/types';

interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: Pipeline[];
  features?: Feature[];
  form: Omit<TaskCreateInput, 'projectId'>;
  onFormChange: (form: Omit<TaskCreateInput, 'projectId'>) => void;
  onCreate: () => void;
  creating: boolean;
}

export function TaskCreateDialog({
  open,
  onOpenChange,
  pipelines,
  features,
  form,
  onFormChange,
  onCreate,
  creating,
}: TaskCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Pipeline</Label>
            <Select value={form.pipelineId} onValueChange={(v) => onFormChange({ ...form, pipelineId: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select pipeline" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => onFormChange({ ...form, title: e.target.value })}
              placeholder="Task title"
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={form.description ?? ''}
              onChange={(e) => onFormChange({ ...form, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
          {features && features.length > 0 && (
            <div className="space-y-2">
              <Label>Feature</Label>
              <Select
                value={form.featureId ?? '__none__'}
                onValueChange={(v) => onFormChange({ ...form, featureId: v === '__none__' ? undefined : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No feature" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No feature</SelectItem>
                  {features.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onCreate}
            disabled={creating || !form.title.trim() || !form.pipelineId}
          >
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
