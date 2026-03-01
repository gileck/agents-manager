import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import type { AppServices } from '../../core/providers/setup';
import type { KanbanBoardCreateInput, KanbanBoardUpdateInput } from '../../shared/types';

const VALID_SORT_BY = ['priority', 'created', 'updated', 'manual'] as const;
const VALID_SORT_DIRECTION = ['asc', 'desc'] as const;
const VALID_CARD_HEIGHT = ['compact', 'normal', 'expanded'] as const;

/**
 * Validate kanban enum fields against allowed values.
 * Throws if any field contains an invalid value.
 */
function validateKanbanEnums(input: KanbanBoardUpdateInput): void {
  if (input.sortBy !== undefined && !(VALID_SORT_BY as readonly string[]).includes(input.sortBy)) {
    throw new Error(`Invalid sortBy value: ${input.sortBy}. Must be one of: ${VALID_SORT_BY.join(', ')}`);
  }
  if (input.sortDirection !== undefined && !(VALID_SORT_DIRECTION as readonly string[]).includes(input.sortDirection)) {
    throw new Error(`Invalid sortDirection value: ${input.sortDirection}. Must be one of: ${VALID_SORT_DIRECTION.join(', ')}`);
  }
  if (input.cardHeight !== undefined && !(VALID_CARD_HEIGHT as readonly string[]).includes(input.cardHeight)) {
    throw new Error(`Invalid cardHeight value: ${input.cardHeight}. Must be one of: ${VALID_CARD_HEIGHT.join(', ')}`);
  }
}

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
    validateKanbanEnums(input as KanbanBoardUpdateInput);
    return services.kanbanBoardStore.updateBoard(id, input as KanbanBoardUpdateInput);
  });

  registerIpcHandler(IPC_CHANNELS.KANBAN_BOARD_DELETE, async (_, id: string) => {
    validateId(id);
    return services.kanbanBoardStore.deleteBoard(id);
  });
}
