import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { AutomatedAgentCreateInput, AutomatedAgentUpdateInput } from '../../shared/types';

export function registerAutomatedAgentHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.AUTOMATED_AGENT_LIST, async (_, projectId?: string) => {
    return api.automatedAgents.list(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.AUTOMATED_AGENT_GET, async (_, id: string) => {
    return api.automatedAgents.get(id);
  });

  registerIpcHandler(IPC_CHANNELS.AUTOMATED_AGENT_CREATE, async (_, input: AutomatedAgentCreateInput) => {
    return api.automatedAgents.create(input);
  });

  registerIpcHandler(IPC_CHANNELS.AUTOMATED_AGENT_UPDATE, async (_, id: string, input: AutomatedAgentUpdateInput) => {
    return api.automatedAgents.update(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.AUTOMATED_AGENT_DELETE, async (_, id: string) => {
    return api.automatedAgents.delete(id);
  });

  registerIpcHandler(IPC_CHANNELS.AUTOMATED_AGENT_TRIGGER, async (_, id: string) => {
    return api.automatedAgents.trigger(id);
  });

  registerIpcHandler(IPC_CHANNELS.AUTOMATED_AGENT_RUNS, async (_, id: string, limit?: number) => {
    return api.automatedAgents.getRuns(id, limit);
  });

  registerIpcHandler(IPC_CHANNELS.AUTOMATED_AGENT_TEMPLATES, async () => {
    return api.automatedAgents.listTemplates();
  });
}
