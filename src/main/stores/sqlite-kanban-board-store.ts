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
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    columns: JSON.parse(row.columns) as KanbanColumn[],
    filters: JSON.parse(row.filters) as KanbanFilters,
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
    const row = this.db.prepare('SELECT * FROM kanban_boards WHERE id = ?').get(id) as KanbanBoardRow | undefined;
    return row ? rowToBoard(row) : null;
  }

  async getBoardByProject(projectId: string): Promise<KanbanBoardConfig | null> {
    const row = this.db.prepare('SELECT * FROM kanban_boards WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId) as KanbanBoardRow | undefined;
    return row ? rowToBoard(row) : null;
  }

  async listBoards(projectId: string): Promise<KanbanBoardConfig[]> {
    const rows = this.db.prepare('SELECT * FROM kanban_boards WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as KanbanBoardRow[];
    return rows.map(rowToBoard);
  }

  async createBoard(input: KanbanBoardCreateInput): Promise<KanbanBoardConfig> {
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

    return (await this.getBoard(id))!;
  }

  async updateBoard(id: string, input: KanbanBoardUpdateInput): Promise<KanbanBoardConfig | null> {
    const existing = await this.getBoard(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.columns !== undefined) {
      updates.push('columns = ?');
      values.push(JSON.stringify(input.columns));
    }
    if (input.filters !== undefined) {
      updates.push('filters = ?');
      values.push(JSON.stringify(input.filters));
    }
    if (input.sortBy !== undefined) {
      updates.push('sort_by = ?');
      values.push(input.sortBy);
    }
    if (input.sortDirection !== undefined) {
      updates.push('sort_direction = ?');
      values.push(input.sortDirection);
    }
    if (input.cardHeight !== undefined) {
      updates.push('card_height = ?');
      values.push(input.cardHeight);
    }
    if (input.showSubtasks !== undefined) {
      updates.push('show_subtasks = ?');
      values.push(input.showSubtasks ? 1 : 0);
    }
    if (input.showAssignee !== undefined) {
      updates.push('show_assignee = ?');
      values.push(input.showAssignee ? 1 : 0);
    }
    if (input.showTags !== undefined) {
      updates.push('show_tags = ?');
      values.push(input.showTags ? 1 : 0);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = ?');
    values.push(now());
    values.push(id);

    this.db.prepare(`UPDATE kanban_boards SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return (await this.getBoard(id))!;
  }

  async deleteBoard(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM kanban_boards WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
