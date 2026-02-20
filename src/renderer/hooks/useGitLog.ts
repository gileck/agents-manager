import { useIpc } from '@template/renderer/hooks/useIpc';
import type { GitLogEntry } from '../../shared/types';

export function useGitLog(projectId: string | null, count = 50) {
  const { data, loading, error, refetch } = useIpc<GitLogEntry[]>(
    () => projectId ? window.api.git.projectLog(projectId, count) : Promise.resolve([]),
    [projectId, count]
  );
  return { commits: data ?? [], loading, error, refetch };
}

export function useGitBranch(projectId: string | null) {
  const { data, loading, error, refetch } = useIpc<string>(
    () => projectId ? window.api.git.branch(projectId) : Promise.resolve(''),
    [projectId]
  );
  return { branch: data ?? '', loading, error, refetch };
}
