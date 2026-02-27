import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import type { AppServices } from '../providers/setup';
import type { AgentDefinitionCreateInput, AgentDefinitionUpdateInput } from '../../shared/types';

export function registerAgentDefHandlers(services: AppServices): void {
  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_LIST, async () => {
    return services.agentDefinitionStore.listDefinitions();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_GET, async (_, id: string) => {
    validateId(id);
    return services.agentDefinitionStore.getDefinition(id);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_CREATE, async (_, input: AgentDefinitionCreateInput) => {
    validateInput(input, ['name', 'engine']);
    return services.agentDefinitionStore.createDefinition(input);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_UPDATE, async (_, id: string, input: AgentDefinitionUpdateInput) => {
    validateId(id);
    return services.agentDefinitionStore.updateDefinition(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_DELETE, async (_, id: string) => {
    validateId(id);
    return services.agentDefinitionStore.deleteDefinition(id);
  });

  // ============================================
  // Agent Lib Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.AGENT_LIB_LIST_MODELS, async () => {
    return services.agentLibRegistry.getAllModels();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_LIB_LIST, async () => {
    return services.agentLibRegistry.getAvailableLibs();
  });
}
