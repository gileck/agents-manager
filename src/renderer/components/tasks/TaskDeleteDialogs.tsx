import React from 'react';
import { Button } from '../ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import type { Task } from '../../../shared/types';

interface TaskDeleteDialogProps {
  target: Task | null;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}

export function TaskDeleteDialog({ target, onClose, onConfirm, deleting }: TaskDeleteDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Task</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-4">
          Are you sure you want to delete &quot;{target?.title}&quot;? This action cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BulkDeleteDialogProps {
  open: boolean;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}

export function BulkDeleteDialog({ open, count, onClose, onConfirm, deleting }: BulkDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(open_) => { if (!open_) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {count} Tasks</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-4">
          Are you sure you want to delete {count} task{count > 1 ? 's' : ''}? This action cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting...' : `Delete ${count} task${count > 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
