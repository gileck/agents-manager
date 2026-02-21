import React from 'react';
import { Card, CardHeader, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { KanbanCard } from './KanbanCard';
import type { Task, KanbanColumn as KanbanColumnType } from '../../../shared/types';

interface KanbanColumnProps {
  column: KanbanColumnType;
  tasks: Task[];
  onCardClick: (task: Task) => void;
}

export function KanbanColumn({ column, tasks, onCardClick }: KanbanColumnProps) {
  return (
    <Card className="flex flex-col h-full min-w-[280px] max-w-[320px]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{column.title}</h3>
          <Badge variant="secondary" className="text-xs">
            {tasks.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-2 pt-0">
        {tasks.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-8">
            No tasks
          </div>
        ) : (
          tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              onClick={() => onCardClick(task)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
