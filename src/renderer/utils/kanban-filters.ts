import type { Task, KanbanFilters } from '../../shared/types';

/**
 * Applies filters to a list of tasks
 */
export function applyKanbanFilters(tasks: Task[], filters: KanbanFilters): Task[] {
  return tasks.filter(task => {
    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesTitle = task.title.toLowerCase().includes(searchLower);
      const matchesDescription = task.description?.toLowerCase().includes(searchLower);
      if (!matchesTitle && !matchesDescription) {
        return false;
      }
    }

    // Assignee filter
    if (filters.assignee && task.assignee !== filters.assignee) {
      return false;
    }

    // Tags filter (task must have ALL selected tags)
    if (filters.tags && filters.tags.length > 0) {
      if (!task.tags || task.tags.length === 0) {
        return false;
      }
      const hasAllTags = filters.tags.every(filterTag =>
        task.tags!.includes(filterTag)
      );
      if (!hasAllTags) {
        return false;
      }
    }

    // Feature filter
    if (filters.featureId && task.featureId !== filters.featureId) {
      return false;
    }

    // Pipeline filter
    if (filters.pipelineId && task.pipelineId !== filters.pipelineId) {
      return false;
    }

    return true;
  });
}

/**
 * Sorts tasks based on the specified sort criteria
 */
export function sortKanbanTasks(
  tasks: Task[],
  sortBy: 'priority' | 'created' | 'updated' | 'manual',
  sortDirection: 'asc' | 'desc'
): Task[] {
  const sorted = [...tasks];
  const directionMultiplier = sortDirection === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'priority': {
        const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
        const aPriority = a.priority ? (priorityOrder[a.priority] || 0) : 0;
        const bPriority = b.priority ? (priorityOrder[b.priority] || 0) : 0;
        comparison = aPriority - bPriority;
        break;
      }
      case 'created':
        comparison = a.createdAt - b.createdAt;
        break;
      case 'updated':
        comparison = a.updatedAt - b.updatedAt;
        break;
      case 'manual':
        // For manual sorting, maintain current order (no sorting)
        comparison = 0;
        break;
    }

    return comparison * directionMultiplier;
  });

  return sorted;
}

/**
 * Extracts unique values from tasks for filter options
 */
export function extractFilterOptions(tasks: Task[]): {
  tags: string[];
  assignees: string[];
} {
  const tagsSet = new Set<string>();
  const assigneesSet = new Set<string>();

  tasks.forEach(task => {
    if (task.tags) {
      task.tags.forEach(tag => tagsSet.add(tag));
    }
    if (task.assignee) {
      assigneesSet.add(task.assignee);
    }
  });

  return {
    tags: Array.from(tagsSet).sort(),
    assignees: Array.from(assigneesSet).sort(),
  };
}

/**
 * Checks if any filters are active
 */
export function hasActiveFilters(filters: KanbanFilters): boolean {
  return Boolean(
    filters.search ||
    filters.assignee ||
    (filters.tags && filters.tags.length > 0) ||
    filters.featureId ||
    filters.pipelineId
  );
}

/**
 * Creates an empty filter object
 */
export function createEmptyFilters(): KanbanFilters {
  return {};
}
