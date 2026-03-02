import { useIpc } from '@template/renderer/hooks/useIpc';
import type { AutomatedAgent, AutomatedAgentTemplate, AgentRun } from '../../shared/types';

export function useAutomatedAgents(projectId?: string) {
  const { data, loading, error, refetch } = useIpc<AutomatedAgent[]>(
    () => window.api.automatedAgents.list(projectId),
    [projectId],
  );
  return { agents: data ?? [], loading, error, refetch };
}

export function useAutomatedAgentTemplates() {
  const { data, loading, error } = useIpc<AutomatedAgentTemplate[]>(
    () => window.api.automatedAgents.listTemplates(),
    [],
  );
  return { templates: data ?? [], loading, error };
}

export function useAutomatedAgentRuns(agentId: string) {
  const { data, loading, error, refetch } = useIpc<AgentRun[]>(
    () => window.api.automatedAgents.getRuns(agentId),
    [agentId],
  );
  return { runs: data ?? [], loading, error, refetch };
}
