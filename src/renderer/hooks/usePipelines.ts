import { useIpc } from '@template/renderer/hooks/useIpc';
import type { Pipeline } from '../../shared/types';

export function usePipelines() {
  const { data, loading, error, refetch } = useIpc<Pipeline[]>(
    () => window.api.pipelines.list()
  );
  return { pipelines: data ?? [], loading, error, refetch };
}

export function usePipeline(id: string | undefined) {
  const { data, loading, error, refetch } = useIpc<Pipeline | null>(
    () => id ? window.api.pipelines.get(id) : Promise.resolve(null),
    [id]
  );
  return { pipeline: data, loading, error, refetch };
}
