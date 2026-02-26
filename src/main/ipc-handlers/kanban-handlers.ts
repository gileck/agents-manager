import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import type { AppServices } from '../providers/setup';
import type { KanbanBoardCreateInput, KanbanBoardUpdateInput } from '../../shared/types';

export function registerKanbanHandlers(services: AppServices): void {
  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_GET, async (_, id: string) => {
    validateId(id);
    return services.kanbanBoardStore.getBoard(id);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_GET_BY_PROJECT, async (_, projectId: string) => {
    validateId(projectId);
    return services.kanbanBoardStore.getBoardByProject(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_LIST, async (_, projectId: string) => {
    validateId(projectId);
    return services.kanbanBoardStore.listBoards(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_CREATE, async (_, input: { projectId: string; name: string; columns?: unknown[] }) => {
    validateInput(input, ['projectId', 'name']);
    return services.kanbanBoardStore.createBoard(input as KanbanBoardCreateInput);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_UPDATE, async (_, id: string, input: unknown) => {
    validateId(id);
    validateInput(input, []);
    return services.kanbanBoardStore.updateBoard(id, input as KanbanBoardUpdateInput);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_DELETE, async (_, id: string) => {
    validateId(id);
    return services.kanbanBoardStore.deleteBoard(id);
  });
}
