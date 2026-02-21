import { useIpc } from '@template/renderer/hooks/useIpc';
import type { KanbanBoardConfig } from '../../shared/types';

export function useKanbanBoard(projectId: string | null) {
  const { data, loading, error, refetch } = useIpc<KanbanBoardConfig | null>(
    () => projectId ? window.api.kanbanBoards.getByProject(projectId) : Promise.resolve(null),
    [projectId]
  );
  return { board: data, loading, error, refetch };
}

export function useKanbanBoardById(id: string) {
  const { data, loading, error, refetch } = useIpc<KanbanBoardConfig | null>(
    () => window.api.kanbanBoards.get(id),
    [id]
  );
  return { board: data, loading, error, refetch };
}
