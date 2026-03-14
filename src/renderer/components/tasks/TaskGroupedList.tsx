import React, { useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PipelineBadge } from '../pipeline/PipelineBadge';
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
  onToggleSelectGroup: (taskIds: string[]) => void;
  onClickTask: (id: string) => void;
  onDeleteTask: (task: Task) => void;
  onDuplicateTask: (task: Task) => void;
  onStatusChange: (taskId: string, toStatus: string) => Promise<void>;
}

/** Get the first pipeline from the map (for badge rendering). */
function getFirstPipeline(pipelineMap: Map<string, Pipeline>): Pipeline | null {
  const first = pipelineMap.values().next();
  return first.done ? null : first.value;
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
  onToggleSelectGroup,
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

  const firstPipeline = useMemo(() => getFirstPipeline(pipelineMap), [pipelineMap]);

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
    <div className="space-y-3">
      {Array.from(groups.entries()).map(([groupKey, groupTasks_]) => {
        const isCollapsed = collapsed.has(groupKey);
        const isStatusGroup = groupBy === 'status';

        const groupTaskIds = groupTasks_.map((t) => t.id);
        const allGroupSelected = groupTaskIds.length > 0 && groupTaskIds.every((id) => selectedIds.has(id));
        const someGroupSelected = groupTaskIds.some((id) => selectedIds.has(id));

        return (
          <div key={groupKey} className="rounded-lg border border-border/60 overflow-hidden">
            {/* Group header */}
            <button
              className="group flex items-center gap-2.5 w-full text-left px-3.5 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
              onClick={() => toggleGroup(groupKey)}
            >
              <input
                type="checkbox"
                checked={allGroupSelected}
                ref={(el) => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggleSelectGroup(groupTaskIds)}
                className={`h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer transition-opacity shrink-0 ${
                  selectMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              />
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              )}

              {isStatusGroup ? (
                <PipelineBadge status={groupKey} pipeline={firstPipeline} />
              ) : (
                <span className="font-medium text-sm text-foreground truncate" title={groupKey}>
                  {groupKey}
                </span>
              )}

              <div className="flex-1" />

              <span className="text-xs text-muted-foreground tabular-nums">
                {groupTasks_.length}
              </span>
            </button>

            {!isCollapsed && (
              <div className={
                viewMode === 'list'
                  ? 'divide-y divide-border/60'
                  : 'p-2 space-y-2'
              }>
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
                    hideStatus={isStatusGroup}
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
