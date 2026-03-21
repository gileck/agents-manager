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
import { ImagePasteArea } from '../ui/ImagePasteArea';
import type { Pipeline, Feature, TaskCreateInput, TaskType, ChatImage } from '../../../shared/types';

interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: Pipeline[];
  features?: Feature[];
  form: Omit<TaskCreateInput, 'projectId'>;
  onFormChange: (form: Omit<TaskCreateInput, 'projectId'>) => void;
  onCreate: () => void;
  creating: boolean;
  images?: ChatImage[];
  onImagesChange?: (images: ChatImage[]) => void;
  /** Called when user clicks "Create + Triage" — creates the task then transitions to triaging */
  onCreateAndTriage?: () => void;
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
  images,
  onImagesChange,
  onCreateAndTriage,
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
            <Label>Type</Label>
            <Select value={form.type ?? 'feature'} onValueChange={(v) => onFormChange({ ...form, type: v as TaskType })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feature">Feature</SelectItem>
                <SelectItem value="bug">Bug</SelectItem>
                <SelectItem value="improvement">Improvement</SelectItem>
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
          {images && onImagesChange && (
            <div className="space-y-2">
              <Label>Screenshots</Label>
              <ImagePasteArea images={images} onImagesChange={onImagesChange} />
            </div>
          )}
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
          <div className="inline-flex gap-1">
            <Button
              onClick={onCreate}
              disabled={creating || !form.title.trim() || !form.pipelineId}
            >
              {creating ? 'Creating...' : 'Create'}
            </Button>
            {onCreateAndTriage && (
              <Button
                variant="outline"
                onClick={onCreateAndTriage}
                disabled={creating || !form.title.trim() || !form.pipelineId}
                title="Create the task and immediately start triaging"
              >
                Create + Triage
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
