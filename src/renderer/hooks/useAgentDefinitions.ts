import { useIpc } from '@template/renderer/hooks/useIpc';
import type { AgentDefinition } from '../../shared/types';

export function useAgentDefinitions() {
  const { data, loading, error, refetch } = useIpc<AgentDefinition[]>(
    () => window.api.agentDefinitions.list()
  );
  return { definitions: data ?? [], loading, error, refetch };
}
