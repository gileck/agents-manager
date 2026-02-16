import { useIpc } from '@template/renderer/hooks/useIpc';
import type { Task, TaskFilter } from '../../shared/types';

export function useTasks(filter?: TaskFilter) {
  const { data, loading, error, refetch } = useIpc<Task[]>(
    () => window.api.tasks.list(filter),
    [JSON.stringify(filter)]
  );
  return { tasks: data ?? [], loading, error, refetch };
}

export function useTask(id: string) {
  const { data, loading, error, refetch } = useIpc<Task | null>(
    () => window.api.tasks.get(id),
    [id]
  );
  return { task: data, loading, error, refetch };
}
