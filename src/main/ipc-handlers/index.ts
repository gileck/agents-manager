import { app } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import * as itemService from '../../core/services/item-service';
import type { AppServices } from '../../core/providers/setup';
import type { ItemCreateInput, ItemUpdateInput } from '../../shared/types';

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

export function registerIpcHandlers(services: AppServices): void {
  // ============================================
  // Item Operations (template)
  // ============================================

  registerIpcHandler(IPC_CHANNELS.ITEM_LIST, async () => {
    return itemService.listItems(services.db);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_GET, async (_, id: string) => {
    validateId(id);
    return itemService.getItem(services.db, id);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_CREATE, async (_, input: ItemCreateInput) => {
    validateInput(input, ['name']);
    return itemService.createItem(services.db, input);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_UPDATE, async (_, id: string, input: ItemUpdateInput) => {
    validateId(id);
    return itemService.updateItem(services.db, id, input);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_DELETE, async (_, id: string) => {
    validateId(id);
    return itemService.deleteItem(services.db, id);
  });

  // ============================================
  // Settings Operations
  // ============================================

  registerSettingsHandlers(services);

  // ============================================
  // App Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.APP_GET_VERSION, async () => {
    return app.getVersion();
  });

  // ============================================
  // Domain Handler Groups
  // ============================================

  registerProjectHandlers(services);
  registerTaskHandlers(services);
  registerPipelineHandlers(services);
  registerAgentHandlers(services);
  registerAgentDefHandlers(services);
  registerFeatureHandlers(services);
  registerKanbanHandlers(services);
  registerGitHandlers(services);
  registerTelegramHandlers(services);
  registerChatSessionHandlers(services);
  registerShellHandlers();
}
