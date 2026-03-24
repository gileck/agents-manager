import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { AgentDefinitionCreateInput, AgentDefinitionUpdateInput, AgentMode, RevisionReason } from '../../shared/types';

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
  // File-based Agent Config (.agents/)
  // ============================================

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_LIST_TYPES, async () => {
    return api.agentDefinitions.listTypes();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_EFFECTIVE, async (_, agentType: string, projectId: string, mode?: AgentMode, revisionReason?: RevisionReason) => {
    return api.agentDefinitions.getEffective(agentType, projectId, mode, revisionReason);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_INIT_FILES, async (_, agentType: string, projectId: string, force?: boolean) => {
    return api.agentDefinitions.initFiles(agentType, projectId, force);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_DELETE_FILES, async (_, agentType: string, projectId: string) => {
    return api.agentDefinitions.deleteFiles(agentType, projectId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_UPDATE_PROMPT, async (_, agentType: string, projectId: string, content: string) => {
    return api.agentDefinitions.updatePrompt(agentType, projectId, content);
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
