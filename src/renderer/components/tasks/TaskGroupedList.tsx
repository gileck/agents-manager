import React, { useMemo, useCallback } from 'react';
import { Badge } from '../ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { TaskRow } from './TaskRow';
import { groupTasks, sortGroupEntries } from './task-helpers';
import type { GroupBy, ViewMode } from './task-helpers';
import type { Task, Pipeline, Feature } from '../../../shared/types';
import { useLocalStorage } from '../../hooks/useLocalStorage';

interface TaskGroupedListProps {
  tasks: Task[];
  groupBy: GroupBy;
  viewMode?: ViewMode;
  pipelineMap: Map<string, Pipeline>;
  featureMap?: Map<string, Feature>;
  activeTaskIds: Set<string>;
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onClickTask: (id: string) => void;
  onDeleteTask: (task: Task) => void;
  onDuplicateTask: (task: Task) => void;
  onStatusChange: (taskId: string, toStatus: string) => Promise<void>;
}

export function TaskGroupedList({
  tasks,
  groupBy,
  viewMode = 'card',
  pipelineMap,
  featureMap,
  activeTaskIds,
  selectMode,
  selectedIds,
  onToggleSelect,
  onClickTask,
  onDeleteTask,
  onDuplicateTask,
  onStatusChange,
}: TaskGroupedListProps) {
  const groups = useMemo(
    () => sortGroupEntries(groupTasks(tasks, groupBy, pipelineMap, featureMap), groupBy, pipelineMap),
    [tasks, groupBy, pipelineMap, featureMap],
  );

  const [collapsedArray, setCollapsedArray] = useLocalStorage<string[]>('taskList.collapsedGroups', []);

  const collapsed = useMemo(() => new Set(collapsedArray), [collapsedArray]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedArray((prev) => {
      const set = new Set(prev);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return Array.from(set);
    });
  }, [setCollapsedArray]);

  const getFeatureName = (task: Task) =>
    task.featureId ? featureMap?.get(task.featureId)?.title : undefined;

  if (groupBy === 'none') {
    return (
      <div className={viewMode === 'list' ? 'border rounded-lg overflow-hidden divide-y divide-border' : 'space-y-2'}>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            pipeline={pipelineMap.get(task.pipelineId) ?? null}
            hasActiveAgent={activeTaskIds.has(task.id)}
            featureName={getFeatureName(task)}
            selectMode={selectMode}
            selected={selectedIds.has(task.id)}
            onToggleSelect={() => onToggleSelect(task.id)}
            onClick={() => onClickTask(task.id)}
            onDelete={() => onDeleteTask(task)}
            onDuplicate={() => onDuplicateTask(task)}
            onStatusChange={onStatusChange}
            viewMode={viewMode}
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
            {/* Enhanced group header */}
            <button
              className="flex items-center gap-2 mb-1.5 w-full text-left px-3 py-2 rounded-md bg-muted/40 border-l-2 border-l-primary/60 hover:bg-muted/60 transition-colors"
              onClick={() => toggleGroup(groupKey)}
            >
              <span
                className="font-semibold text-sm text-foreground flex-1 truncate"
                title={groupKey}
              >
                {groupKey}
              </span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                {groupTasks_.length}
              </Badge>
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </button>

            {!isCollapsed && (
              <div className={viewMode === 'list' ? 'border rounded-lg overflow-hidden divide-y divide-border' : 'space-y-2'}>
                {groupTasks_.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    pipeline={pipelineMap.get(task.pipelineId) ?? null}
                    hasActiveAgent={activeTaskIds.has(task.id)}
                    featureName={getFeatureName(task)}
                    selectMode={selectMode}
                    selected={selectedIds.has(task.id)}
                    onToggleSelect={() => onToggleSelect(task.id)}
                    onClick={() => onClickTask(task.id)}
                    onDelete={() => onDeleteTask(task)}
                    onDuplicate={() => onDuplicateTask(task)}
                    onStatusChange={onStatusChange}
                    viewMode={viewMode}
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
