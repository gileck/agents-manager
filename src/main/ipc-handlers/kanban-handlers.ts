import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { KanbanBoardCreateInput, KanbanBoardUpdateInput } from '../../shared/types';

export function registerKanbanHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_GET, async (_, id: string) => {
    return api.kanban.getBoard(id);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_GET_BY_PROJECT, async (_, projectId: string) => {
    return api.kanban.getBoardByProject(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_LIST, async (_, projectId: string) => {
    return api.kanban.listBoards(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_CREATE, async (_, input: KanbanBoardCreateInput) => {
    return api.kanban.createBoard(input);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_UPDATE, async (_, id: string, input: KanbanBoardUpdateInput) => {
    return api.kanban.updateBoard(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_DELETE, async (_, id: string) => {
    return api.kanban.deleteBoard(id);
  });
}
