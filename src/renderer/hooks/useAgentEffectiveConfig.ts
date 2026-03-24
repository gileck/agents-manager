import { useState, useEffect, useCallback } from 'react';
import type { EffectiveAgentConfig } from '../../shared/types';

export function useAgentEffectiveConfig(agentType: string | null, projectId: string | null) {
  const [config, setConfig] = useState<EffectiveAgentConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!agentType || !projectId) {
      setConfig(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.agentDefinitions.getEffective(agentType, projectId);
      setConfig(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [agentType, projectId]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { config, loading, error, refetch: fetch };
}
