import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Settings } from 'lucide-react';
import type { KanbanBoardConfig, KanbanBoardUpdateInput } from '../../../shared/types';

interface KanbanBoardConfigProps {
  board: KanbanBoardConfig;
  onUpdate: (input: KanbanBoardUpdateInput) => Promise<void>;
}

export function KanbanBoardConfigDialog({ board, onUpdate }: KanbanBoardConfigProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(board.name);
  const [sortBy, setSortBy] = useState<'priority' | 'created' | 'updated' | 'manual'>(board.sortBy);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(board.sortDirection);
  const [cardHeight, setCardHeight] = useState<'compact' | 'normal' | 'expanded'>(board.cardHeight);
  const [showSubtasks, setShowSubtasks] = useState(board.showSubtasks);
  const [showAssignee, setShowAssignee] = useState(board.showAssignee);
  const [showTags, setShowTags] = useState(board.showTags);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({
        name,
        sortBy,
        sortDirection,
        cardHeight,
        showSubtasks,
        showAssignee,
        showTags,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset to original values
    setName(board.name);
    setSortBy(board.sortBy);
    setSortDirection(board.sortDirection);
    setCardHeight(board.cardHeight);
    setShowSubtasks(board.showSubtasks);
    setShowAssignee(board.showAssignee);
    setShowTags(board.showTags);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="w-4 h-4 mr-2" />
          Board Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Board Settings</DialogTitle>
          <DialogDescription>
            Customize how your kanban board is displayed
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {/* Board Name */}
          <div className="space-y-2">
            <Label htmlFor="board-name">Board Name</Label>
            <Input
              id="board-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter board name"
            />
          </div>

          {/* Sort Options */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Sorting</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sort-by">Sort By</Label>
                <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
                  <SelectTrigger id="sort-by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priority">Priority</SelectItem>
                    <SelectItem value="created">Created Date</SelectItem>
                    <SelectItem value="updated">Updated Date</SelectItem>
                    <SelectItem value="manual">Manual Order</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sort-direction">Direction</Label>
                <Select value={sortDirection} onValueChange={(value) => setSortDirection(value as typeof sortDirection)}>
                  <SelectTrigger id="sort-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Card Appearance */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Card Appearance</h4>
            <div className="space-y-2">
              <Label htmlFor="card-height">Card Height</Label>
              <Select value={cardHeight} onValueChange={(value) => setCardHeight(value as typeof cardHeight)}>
                <SelectTrigger id="card-height">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="expanded">Expanded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Display Options */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Display Options</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="show-subtasks" className="cursor-pointer">
                  Show Subtasks
                </Label>
                <Switch
                  id="show-subtasks"
                  checked={showSubtasks}
                  onCheckedChange={setShowSubtasks}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="show-assignee" className="cursor-pointer">
                  Show Assignee
                </Label>
                <Switch
                  id="show-assignee"
                  checked={showAssignee}
                  onCheckedChange={setShowAssignee}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="show-tags" className="cursor-pointer">
                  Show Tags
                </Label>
                <Switch
                  id="show-tags"
                  checked={showTags}
                  onCheckedChange={setShowTags}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
