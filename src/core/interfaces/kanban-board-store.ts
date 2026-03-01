import type { KanbanBoardConfig, KanbanBoardCreateInput, KanbanBoardUpdateInput } from '../../shared/types';

export interface IKanbanBoardStore {
  getBoard(id: string): Promise<KanbanBoardConfig | null>;
  getBoardByProject(projectId: string): Promise<KanbanBoardConfig | null>;
  listBoards(projectId: string): Promise<KanbanBoardConfig[]>;
  createBoard(input: KanbanBoardCreateInput): Promise<KanbanBoardConfig>;
  updateBoard(id: string, input: KanbanBoardUpdateInput): Promise<KanbanBoardConfig | null>;
  deleteBoard(id: string): Promise<boolean>;
}
