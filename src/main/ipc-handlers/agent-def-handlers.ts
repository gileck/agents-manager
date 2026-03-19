import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { AgentDefinitionCreateInput, AgentDefinitionUpdateInput } from '../../shared/types';

export function registerAgentDefHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_LIST, async () => {
    return api.agentDefinitions.list();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_GET, async (_, id: string) => {
    return api.agentDefinitions.get(id);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_CREATE, async (_, input: AgentDefinitionCreateInput) => {
    return api.agentDefinitions.create(input);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_UPDATE, async (_, id: string, input: AgentDefinitionUpdateInput) => {
    return api.agentDefinitions.update(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_DELETE, async (_, id: string) => {
    return api.agentDefinitions.delete(id);
  });

  // ============================================
  // Agent Lib Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.AGENT_LIB_LIST_MODELS, async () => {
    return api.agentDefinitions.listModels();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_LIB_LIST, async () => {
    return api.agentDefinitions.listLibs();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_LIB_LIST_FEATURES, async () => {
    return api.agentDefinitions.listFeatures();
  });
}
