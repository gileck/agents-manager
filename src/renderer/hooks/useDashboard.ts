import { useIpc } from '@template/renderer/hooks/useIpc';
import type { DashboardStats } from '../../shared/types';

export function useDashboard() {
  const { data, loading, error, refetch } = useIpc<DashboardStats>(
    () => window.api.dashboard.stats()
  );
  return { stats: data, loading, error, refetch };
}
