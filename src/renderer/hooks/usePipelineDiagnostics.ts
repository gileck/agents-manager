import { useState, useEffect, useCallback } from 'react';
import type { PipelineDiagnostics } from '../../shared/types';

export function usePipelineDiagnostics(taskId: string | undefined, taskStatus?: string) {
  const [diagnostics, setDiagnostics] = useState<PipelineDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiagnostics = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.tasks.pipelineDiagnostics(taskId);
      setDiagnostics(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load diagnostics';
      setError(message);
      console.error('Pipeline diagnostics failed:', message);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchDiagnostics();
  }, [fetchDiagnostics, taskStatus]);

  return { diagnostics, loading, error, refetch: fetchDiagnostics };
}
