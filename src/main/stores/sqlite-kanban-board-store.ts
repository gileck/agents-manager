import type Database from 'better-sqlite3';
import type { KanbanBoardConfig, KanbanBoardCreateInput, KanbanBoardUpdateInput, KanbanColumn, KanbanFilters } from '../../shared/types';
import type { IKanbanBoardStore } from '../interfaces/kanban-board-store';
import { generateId, now } from './utils';

interface KanbanBoardRow {
  id: string;
  project_id: string;
  name: string;
  columns: string;
  filters: string;
  sort_by: string;
  sort_direction: string;
  card_height: string;
  show_subtasks: number;
  show_assignee: number;
  show_tags: number;
  created_at: number;
  updated_at: number;
}

function rowToBoard(row: KanbanBoardRow): KanbanBoardConfig {
  let columns: KanbanColumn[];
  let filters: KanbanFilters;

  try {
    columns = JSON.parse(row.columns);
    if (!Array.isArray(columns)) {
      throw new Error('Columns must be an array');
    }
  } catch (error) {
    const errorMsg = `Corrupted kanban board data for board ${row.id}: invalid columns format. Raw data: ${row.columns}`;
    console.error(errorMsg, error);
    throw new Error(errorMsg);
  }

  try {
    filters = JSON.parse(row.filters);
    if (typeof filters !== 'object' || filters === null || Array.isArray(filters)) {
      throw new Error('Filters must be an object');
    }
  } catch (error) {
    const errorMsg = `Corrupted kanban board data for board ${row.id}: invalid filters format. Raw data: ${row.filters}`;
    console.error(errorMsg, error);
    throw new Error(errorMsg);
  }

  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    columns,
    filters,
    sortBy: row.sort_by as 'priority' | 'created' | 'updated' | 'manual',
    sortDirection: row.sort_direction as 'asc' | 'desc',
    cardHeight: row.card_height as 'compact' | 'normal' | 'expanded',
    showSubtasks: row.show_subtasks === 1,
    showAssignee: row.show_assignee === 1,
    showTags: row.show_tags === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteKanbanBoardStore implements IKanbanBoardStore {
  constructor(private db: Database.Database) {}

  async getBoard(id: string): Promise<KanbanBoardConfig | null> {
    try {
      const row = this.db.prepare('SELECT * FROM kanban_boards WHERE id = ?').get(id) as KanbanBoardRow | undefined;
      return row ? rowToBoard(row) : null;
    } catch (error) {
      console.error('Failed to get kanban board:', error);
      throw new Error(`Failed to get kanban board: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getBoardByProject(projectId: string): Promise<KanbanBoardConfig | null> {
    try {
      const row = this.db.prepare('SELECT * FROM kanban_boards WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId) as KanbanBoardRow | undefined;
      return row ? rowToBoard(row) : null;
    } catch (error) {
      console.error('Failed to get kanban board by project:', error);
      throw new Error(`Failed to get kanban board by project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async listBoards(projectId: string): Promise<KanbanBoardConfig[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM kanban_boards WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as KanbanBoardRow[];
      return rows.map(rowToBoard);
    } catch (error) {
      console.error('Failed to list kanban boards:', error);
      throw new Error(`Failed to list kanban boards: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createBoard(input: KanbanBoardCreateInput): Promise<KanbanBoardConfig> {
    try {
      const id = generateId();
      const timestamp = now();

      const columns: KanbanColumn[] = input.columns ?? [];
      const filters: KanbanFilters = {};

      this.db.prepare(`
        INSERT INTO kanban_boards (
          id, project_id, name, columns, filters,
          sort_by, sort_direction, card_height,
          show_subtasks, show_assignee, show_tags,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.projectId,
        input.name,
        JSON.stringify(columns),
        JSON.stringify(filters),
        'manual',
        'asc',
        'normal',
        1,
        1,
        1,
        timestamp,
        timestamp
      );

      const board = await this.getBoard(id);
      if (!board) {
        throw new Error('Failed to retrieve created board');
      }
      return board;
    } catch (error) {
      console.error('Failed to create kanban board:', error);
      throw new Error(`Failed to create kanban board: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateBoard(id: string, input: KanbanBoardUpdateInput): Promise<KanbanBoardConfig | null> {
    try {
      const existing = await this.getBoard(id);
      if (!existing) return null;

      // Build safe update query using parameterized statements
      const updateFields: { field: string; value: unknown }[] = [];

      if (input.name !== undefined) {
        updateFields.push({ field: 'name', value: input.name });
      }
      if (input.columns !== undefined) {
        updateFields.push({ field: 'columns', value: JSON.stringify(input.columns) });
      }
      if (input.filters !== undefined) {
        updateFields.push({ field: 'filters', value: JSON.stringify(input.filters) });
      }
      if (input.sortBy !== undefined) {
        updateFields.push({ field: 'sort_by', value: input.sortBy });
      }
      if (input.sortDirection !== undefined) {
        updateFields.push({ field: 'sort_direction', value: input.sortDirection });
      }
      if (input.cardHeight !== undefined) {
        updateFields.push({ field: 'card_height', value: input.cardHeight });
      }
      if (input.showSubtasks !== undefined) {
        updateFields.push({ field: 'show_subtasks', value: input.showSubtasks ? 1 : 0 });
      }
      if (input.showAssignee !== undefined) {
        updateFields.push({ field: 'show_assignee', value: input.showAssignee ? 1 : 0 });
      }
      if (input.showTags !== undefined) {
        updateFields.push({ field: 'show_tags', value: input.showTags ? 1 : 0 });
      }

      if (updateFields.length === 0) return existing;

      // Add updated_at field
      updateFields.push({ field: 'updated_at', value: now() });

      // Build parameterized query - field names are from a controlled set above
      const setClauses = updateFields.map(f => `${f.field} = ?`).join(', ');
      const values = updateFields.map(f => f.value);
      values.push(id);

      this.db.prepare(`UPDATE kanban_boards SET ${setClauses} WHERE id = ?`).run(...values);
      return await this.getBoard(id);
    } catch (error) {
      console.error('Failed to update kanban board:', error);
      throw new Error(`Failed to update kanban board: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async deleteBoard(id: string): Promise<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM kanban_boards WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (error) {
      console.error('Failed to delete kanban board:', error);
      throw new Error(`Failed to delete kanban board: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
