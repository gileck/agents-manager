import React, { useState, useMemo } from 'react';
import { Badge } from '../ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { TaskRow } from './TaskRow';
import { groupTasks } from './task-helpers';
import type { GroupBy } from './task-helpers';
import type { Task, Pipeline } from '../../../shared/types';

interface TaskGroupedListProps {
  tasks: Task[];
  groupBy: GroupBy;
  pipelineMap: Map<string, Pipeline>;
  activeTaskIds: Set<string>;
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onClickTask: (id: string) => void;
  onDeleteTask: (task: Task) => void;
  onDuplicateTask: (task: Task) => void;
}

export function TaskGroupedList({
  tasks,
  groupBy,
  pipelineMap,
  activeTaskIds,
  selectMode,
  selectedIds,
  onToggleSelect,
  onClickTask,
  onDeleteTask,
  onDuplicateTask,
}: TaskGroupedListProps) {
  const groups = useMemo(
    () => groupTasks(tasks, groupBy, pipelineMap),
    [tasks, groupBy, pipelineMap],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (groupBy === 'none') {
    return (
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            pipeline={pipelineMap.get(task.pipelineId) ?? null}
            hasActiveAgent={activeTaskIds.has(task.id)}
            selectMode={selectMode}
            selected={selectedIds.has(task.id)}
            onToggleSelect={() => onToggleSelect(task.id)}
            onClick={() => onClickTask(task.id)}
            onDelete={() => onDeleteTask(task)}
            onDuplicate={() => onDuplicateTask(task)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([groupKey, groupTasks_]) => {
        const isCollapsed = collapsed.has(groupKey);
        return (
          <div key={groupKey}>
            <button
              className="flex items-center gap-2 mb-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
              onClick={() => toggleGroup(groupKey)}
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <span>{groupKey}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {groupTasks_.length}
              </Badge>
            </button>
            {!isCollapsed && (
              <div className="space-y-2">
                {groupTasks_.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    pipeline={pipelineMap.get(task.pipelineId) ?? null}
                    hasActiveAgent={activeTaskIds.has(task.id)}
                    selectMode={selectMode}
                    selected={selectedIds.has(task.id)}
                    onToggleSelect={() => onToggleSelect(task.id)}
                    onClick={() => onClickTask(task.id)}
                    onDelete={() => onDeleteTask(task)}
                    onDuplicate={() => onDuplicateTask(task)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
