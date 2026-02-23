import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { Subtask, SubtaskStatus } from '../../../shared/types';

interface SubtasksSectionProps {
  taskId: string;
  subtasks: Subtask[];
  onUpdate: () => void;
}

export function SubtasksSection({
  taskId,
  subtasks,
  onUpdate,
}: SubtasksSectionProps) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const updateSubtasks = useCallback(async (updated: Subtask[]) => {
    await window.api.tasks.update(taskId, { subtasks: updated });
    onUpdate();
  }, [taskId, onUpdate]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await updateSubtasks([...subtasks, { name: newName.trim(), status: 'open' }]);
      setNewName('');
    } finally {
      setAdding(false);
    }
  };

  const cycleStatus = async (index: number) => {
    const order: SubtaskStatus[] = ['open', 'in_progress', 'done'];
    const current = subtasks[index].status;
    const next = order[(order.indexOf(current) + 1) % order.length];
    const updated = subtasks.map((s, i) => (i === index ? { ...s, status: next } : s));
    try {
      await updateSubtasks(updated);
    } catch (err) {
      console.error('Failed to cycle subtask status', err);
    }
  };

  const removeSubtask = async (index: number) => {
    try {
      await updateSubtasks(subtasks.filter((_, i) => i !== index));
    } catch (err) {
      console.error('Failed to remove subtask', err);
    }
  };

  const doneCount = subtasks.filter((s) => s.status === 'done').length;

  return (
    <Card className="mt-4">
      <CardHeader className="py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Subtasks
          {subtasks.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {doneCount}/{subtasks.length} done
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {subtasks.length > 0 && (
          <div className="space-y-1 mb-3">
            {subtasks.map((st, i) => (
              <div key={i} className="flex items-center gap-2 group py-1">
                <button
                  onClick={() => cycleStatus(i)}
                  className="flex items-center justify-center w-5 h-5 rounded-full border-2 shrink-0 transition-colors"
                  style={{
                    borderColor: st.status === 'done' ? '#22c55e' : st.status === 'in_progress' ? '#3b82f6' : '#d1d5db',
                    backgroundColor: st.status === 'done' ? '#22c55e' : 'transparent',
                  }}
                  title={`Status: ${st.status} (click to cycle)`}
                >
                  {st.status === 'done' && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6l2.5 2.5 4.5-4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {st.status === 'in_progress' && (
                    <span
                      className="inline-block w-2 h-2 rounded-full animate-pulse"
                      style={{ backgroundColor: '#3b82f6' }}
                    />
                  )}
                </button>
                <span
                  className="text-sm flex-1"
                  style={{
                    textDecoration: st.status === 'done' ? 'line-through' : undefined,
                    color: st.status === 'done' ? '#9ca3af' : undefined,
                  }}
                >
                  {st.name}
                </span>
                <button
                  onClick={() => removeSubtask(i)}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity text-sm px-1"
                  title="Remove subtask"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add a subtask..."
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
          />
          <Button size="sm" onClick={handleAdd} disabled={adding || !newName.trim()}>
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
