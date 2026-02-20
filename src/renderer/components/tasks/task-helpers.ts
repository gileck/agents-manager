import type { Task, Pipeline, Feature, FeatureWithProgress, FeatureStatus } from '../../../shared/types';

export const PRIORITY_LABELS: Record<number, string> = {
  0: 'P0 - Critical',
  1: 'P1 - High',
  2: 'P2 - Medium',
  3: 'P3 - Low',
};

export type SortField = 'created' | 'updated' | 'priority' | 'status' | 'title';
export type SortDirection = 'asc' | 'desc';
export type GroupBy = 'none' | 'status' | 'priority' | 'pipeline' | 'feature' | 'domain';

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
  featureMap?: Map<string, Feature>,
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
      case 'feature':
        key = task.featureId
          ? (featureMap?.get(task.featureId)?.title ?? task.featureId)
          : 'No Feature';
        break;
      case 'domain':
        key = task.domain ?? 'No Domain';
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

export function collectDomains(tasks: Task[]): string[] {
  const domainSet = new Set<string>();
  for (const task of tasks) {
    if (task.domain) domainSet.add(task.domain);
  }
  return Array.from(domainSet).sort();
}

export function countActiveFilters(filters: {
  search?: string;
  status?: string;
  priority?: string;
  pipelineId?: string;
  assignee?: string;
  tag?: string;
  featureId?: string;
  domain?: string;
}): number {
  let count = 0;
  if (filters.search) count++;
  if (filters.status) count++;
  if (filters.priority) count++;
  if (filters.pipelineId) count++;
  if (filters.assignee) count++;
  if (filters.tag) count++;
  if (filters.featureId) count++;
  if (filters.domain) count++;
  return count;
}

export function buildPipelineMap(pipelines: Pipeline[]): Map<string, Pipeline> {
  const map = new Map<string, Pipeline>();
  for (const p of pipelines) {
    map.set(p.id, p);
  }
  return map;
}

export function buildFeatureMap(features: Feature[]): Map<string, Feature> {
  const map = new Map<string, Feature>();
  for (const f of features) {
    map.set(f.id, f);
  }
  return map;
}

export function computeFeatureStatus(
  feature: Feature,
  tasks: Task[],
  pipelineMap: Map<string, Pipeline>,
): FeatureWithProgress {
  const featureTasks = tasks.filter((t) => t.featureId === feature.id);
  const totalTasks = featureTasks.length;

  let doneTasks = 0;
  let initialTasks = 0;

  for (const task of featureTasks) {
    const pipeline = pipelineMap.get(task.pipelineId);
    if (!pipeline) continue;

    const statusDef = pipeline.statuses.find((s) => s.name === task.status);
    if (statusDef?.isFinal) {
      doneTasks++;
    }

    if (pipeline.statuses.length > 0 && task.status === pipeline.statuses[0].name) {
      initialTasks++;
    }
  }

  let status: FeatureStatus;
  if (totalTasks === 0 || initialTasks === totalTasks) {
    status = 'open';
  } else if (doneTasks === totalTasks) {
    status = 'done';
  } else {
    status = 'in_progress';
  }

  return { ...feature, status, totalTasks, doneTasks };
}

/**
 * Groups tasks into parallel dependency layers using Kahn's algorithm.
 * Layer 0: tasks with no dependencies (can all start immediately).
 * Layer N: tasks whose deps are all in layers 0..N-1.
 * Tasks with circular deps or deps outside the provided set go into a final "Other" layer.
 */
export function computeDependencyLayers(
  tasks: Task[],
  depsMap: Map<string, string[]>,
): Task[][] {
  const taskIds = new Set(tasks.map((t) => t.id));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Build in-degree map considering only deps within the feature
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // depId -> taskIds that depend on it

  for (const task of tasks) {
    const deps = (depsMap.get(task.id) ?? []).filter((d) => taskIds.has(d));
    inDegree.set(task.id, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(task.id);
      dependents.set(dep, list);
    }
  }

  const layers: Task[][] = [];
  const placed = new Set<string>();

  // BFS by layers
  let queue = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0);

  while (queue.length > 0) {
    layers.push(queue);
    for (const t of queue) placed.add(t.id);

    const nextQueue: Task[] = [];
    for (const t of queue) {
      for (const depId of (dependents.get(t.id) ?? [])) {
        const deg = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, deg);
        if (deg === 0) {
          const depTask = taskById.get(depId);
          if (depTask) nextQueue.push(depTask);
        }
      }
    }
    queue = nextQueue;
  }

  // Remaining tasks (circular deps or deps outside the feature set)
  const remaining = tasks.filter((t) => !placed.has(t.id));
  if (remaining.length > 0) {
    layers.push(remaining);
  }

  return layers;
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
