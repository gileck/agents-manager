import { useIpc } from '@template/renderer/hooks/useIpc';
import type { Feature, FeatureFilter } from '../../shared/types';

export function useFeatures(filter?: FeatureFilter) {
  const { data, loading, error, refetch } = useIpc<Feature[]>(
    () => window.api.features.list(filter),
    [JSON.stringify(filter)]
  );
  return { features: data ?? [], loading, error, refetch };
}

export function useFeature(id: string) {
  const { data, loading, error, refetch } = useIpc<Feature | null>(
    () => window.api.features.get(id),
    [id]
  );
  return { feature: data, loading, error, refetch };
}
