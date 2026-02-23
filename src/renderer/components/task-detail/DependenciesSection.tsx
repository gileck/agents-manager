import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { useTasks } from '../../hooks/useTasks';
import type { Task } from '../../../shared/types';

interface DependenciesSectionProps {
  taskId: string;
  projectId: string;
}

function DependencyPicker({
  tasks,
  onSelect,
}: {
  tasks: Task[];
  onSelect: (taskId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = tasks.filter((t) =>
    t.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="py-2 space-y-3">
      <Input
        placeholder="Search tasks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <div className="max-h-60 overflow-y-auto space-y-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No matching tasks.</p>
        ) : (
          filtered.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 px-2 py-2 rounded hover:bg-accent cursor-pointer"
              onClick={() => onSelect(t.id)}
            >
              <Badge variant="outline" className="text-[10px] shrink-0">{t.status}</Badge>
              <span className="text-sm truncate">{t.title}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function DependenciesSection({
  taskId,
  projectId,
}: DependenciesSectionProps) {
  const navigate = useNavigate();

  const { data: blockedBy, refetch: refetchDeps } = useIpc<Task[]>(
    () => window.api.tasks.dependencies(taskId),
    [taskId],
  );

  const { data: blocks, refetch: refetchDependents } = useIpc<Task[]>(
    () => window.api.tasks.dependents(taskId),
    [taskId],
  );

  const { tasks: projectTasks } = useTasks({ projectId });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const blockedByIds = new Set((blockedBy ?? []).map((t) => t.id));
  const availableTasks = projectTasks.filter(
    (t) => t.id !== taskId && !blockedByIds.has(t.id),
  );

  const handleAdd = async (depTaskId: string) => {
    try {
      await window.api.tasks.addDependency(taskId, depTaskId);
      setPickerOpen(false);
      await refetchDeps();
      await refetchDependents();
    } catch (err) {
      console.error('Failed to add dependency', err);
    }
  };

  const handleRemove = async (depTaskId: string) => {
    setRemoving(depTaskId);
    try {
      await window.api.tasks.removeDependency(taskId, depTaskId);
      await refetchDeps();
      await refetchDependents();
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="py-3">
        <CardTitle className="text-base">Dependencies</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Blocked By */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">Blocked By</span>
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              Add
            </Button>
          </div>
          {(!blockedBy || blockedBy.length === 0) ? (
            <p className="text-xs text-muted-foreground">No dependencies.</p>
          ) : (
            <div className="space-y-1">
              {blockedBy.map((dep) => (
                <div key={dep.id} className="flex items-center gap-2 group py-1">
                  <Badge variant="outline" className="text-[10px] shrink-0">{dep.status}</Badge>
                  <span
                    className="text-sm text-blue-500 hover:underline cursor-pointer truncate flex-1"
                    onClick={() => navigate(`/tasks/${dep.id}`)}
                  >
                    {dep.title}
                  </span>
                  <button
                    onClick={() => handleRemove(dep.id)}
                    disabled={removing === dep.id}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity text-sm px-1"
                    title="Remove dependency"
                  >
                    {removing === dep.id ? '...' : '\u00d7'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Blocks */}
        <div>
          <span className="text-sm font-medium text-muted-foreground block mb-2">Blocks</span>
          {(!blocks || blocks.length === 0) ? (
            <p className="text-xs text-muted-foreground">No tasks depend on this task.</p>
          ) : (
            <div className="space-y-1">
              {blocks.map((dep) => (
                <div key={dep.id} className="flex items-center gap-2 py-1">
                  <Badge variant="outline" className="text-[10px] shrink-0">{dep.status}</Badge>
                  <span
                    className="text-sm text-blue-500 hover:underline cursor-pointer truncate"
                    onClick={() => navigate(`/tasks/${dep.id}`)}
                  >
                    {dep.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Dependency Picker */}
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Dependency</DialogTitle>
            </DialogHeader>
            <DependencyPicker tasks={availableTasks} onSelect={handleAdd} />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
