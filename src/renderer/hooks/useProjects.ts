import { useIpc } from '@template/renderer/hooks/useIpc';
import type { Project } from '../../shared/types';

export function useProjects() {
  const { data, loading, error, refetch } = useIpc<Project[]>(
    () => window.api.projects.list()
  );
  return { projects: data ?? [], loading, error, refetch };
}
