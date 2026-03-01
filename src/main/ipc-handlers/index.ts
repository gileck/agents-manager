import { app } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';

import { registerSettingsHandlers } from './settings-handlers';
import { registerAgentHandlers } from './agent-handlers';
import { registerKanbanHandlers } from './kanban-handlers';
import { registerTelegramHandlers } from './telegram-handlers';
import { registerChatSessionHandlers } from './chat-session-handlers';
import { registerShellHandlers } from './shell-handlers';
import { registerGitHandlers } from './git-handlers';
import { registerTaskHandlers } from './task-handlers';
import { registerProjectHandlers } from './project-handlers';
import { registerFeatureHandlers } from './feature-handlers';
import { registerAgentDefHandlers } from './agent-def-handlers';
import { registerPipelineHandlers } from './pipeline-handlers';

export function registerIpcHandlers(api: ApiClient): void {
  // ============================================
  // Item Operations (template) — delegate to daemon API
  // ============================================

  registerIpcHandler(IPC_CHANNELS.ITEM_LIST, async () => {
    return api.items.list();
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_GET, async (_, id: string) => {
    return api.items.get(id);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_CREATE, async (_, input: unknown) => {
    return api.items.create(input as Parameters<typeof api.items.create>[0]);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_UPDATE, async (_, id: string, input: unknown) => {
    return api.items.update(id, input as Parameters<typeof api.items.update>[1]);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_DELETE, async (_, id: string) => {
    return api.items.delete(id);
  });

  // ============================================
  // Settings Operations
  // ============================================

  registerSettingsHandlers(api);

  // ============================================
  // App Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.APP_GET_VERSION, async () => {
    return app.getVersion();
  });

  // ============================================
  // Domain Handler Groups
  // ============================================

  registerProjectHandlers(api);
  registerTaskHandlers(api);
  registerPipelineHandlers(api);
  registerAgentHandlers(api);
  registerAgentDefHandlers(api);
  registerFeatureHandlers(api);
  registerKanbanHandlers(api);
  registerGitHandlers(api);
  registerTelegramHandlers(api);
  registerChatSessionHandlers(api);
  registerShellHandlers();
}
