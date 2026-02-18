import type { Task, Pipeline } from '../../../shared/types';

export const PRIORITY_LABELS: Record<number, string> = {
  0: 'P0 - Critical',
  1: 'P1 - High',
  2: 'P2 - Medium',
  3: 'P3 - Low',
};

export type SortField = 'created' | 'updated' | 'priority' | 'status' | 'title';
export type SortDirection = 'asc' | 'desc';
export type GroupBy = 'none' | 'status' | 'priority' | 'pipeline';

export function sortTasks(tasks: Task[], field: SortField, direction: SortDirection): Task[] {
  const sorted = [...tasks].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'priority':
        cmp = a.priority - b.priority;
        break;
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'title':
        cmp = a.title.localeCompare(b.title);
        break;
      case 'updated':
        cmp = a.updatedAt - b.updatedAt;
        break;
      case 'created':
      default:
        cmp = a.createdAt - b.createdAt;
        break;
    }
    return direction === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

export function groupTasks(
  tasks: Task[],
  groupBy: GroupBy,
  pipelineMap?: Map<string, Pipeline>,
): Map<string, Task[]> {
  if (groupBy === 'none') {
    return new Map([['all', tasks]]);
  }

  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    let key: string;
    switch (groupBy) {
      case 'status':
        key = task.status;
        break;
      case 'priority':
        key = PRIORITY_LABELS[task.priority] ?? `P${task.priority}`;
        break;
      case 'pipeline':
        key = pipelineMap?.get(task.pipelineId)?.name ?? task.pipelineId;
        break;
      default:
        key = 'all';
    }
    const list = groups.get(key);
    if (list) {
      list.push(task);
    } else {
      groups.set(key, [task]);
    }
  }
  return groups;
}

export function collectTags(tasks: Task[]): string[] {
  const tagSet = new Set<string>();
  for (const task of tasks) {
    for (const tag of task.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}

export function countActiveFilters(filters: {
  search?: string;
  status?: string;
  priority?: string;
  pipelineId?: string;
  assignee?: string;
  tag?: string;
}): number {
  let count = 0;
  if (filters.search) count++;
  if (filters.status) count++;
  if (filters.priority) count++;
  if (filters.pipelineId) count++;
  if (filters.assignee) count++;
  if (filters.tag) count++;
  return count;
}

export function buildPipelineMap(pipelines: Pipeline[]): Map<string, Pipeline> {
  const map = new Map<string, Pipeline>();
  for (const p of pipelines) {
    map.set(p.id, p);
  }
  return map;
}

export function formatRelativeTimestamp(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
