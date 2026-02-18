import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import type { Pipeline, TaskCreateInput } from '../../../shared/types';

interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: Pipeline[];
  form: Omit<TaskCreateInput, 'projectId'>;
  onFormChange: (form: Omit<TaskCreateInput, 'projectId'>) => void;
  onCreate: () => void;
  creating: boolean;
}

export function TaskCreateDialog({
  open,
  onOpenChange,
  pipelines,
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
            <Input
              value={form.description ?? ''}
              onChange={(e) => onFormChange({ ...form, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
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
