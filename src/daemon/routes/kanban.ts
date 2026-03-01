import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { KanbanBoardCreateInput, KanbanBoardUpdateInput } from '../../shared/types';

const VALID_SORT_BY = ['priority', 'created', 'updated', 'manual'] as const;
const VALID_SORT_DIRECTION = ['asc', 'desc'] as const;
const VALID_CARD_HEIGHT = ['compact', 'normal', 'expanded'] as const;

/**
 * Validate kanban enum fields against allowed values.
 * Returns an error message if invalid, or null if valid.
 */
function validateKanbanEnums(input: KanbanBoardUpdateInput): string | null {
  if (input.sortBy !== undefined && !(VALID_SORT_BY as readonly string[]).includes(input.sortBy)) {
    return `Invalid sortBy value: ${input.sortBy}. Must be one of: ${VALID_SORT_BY.join(', ')}`;
  }
  if (input.sortDirection !== undefined && !(VALID_SORT_DIRECTION as readonly string[]).includes(input.sortDirection)) {
    return `Invalid sortDirection value: ${input.sortDirection}. Must be one of: ${VALID_SORT_DIRECTION.join(', ')}`;
  }
  if (input.cardHeight !== undefined && !(VALID_CARD_HEIGHT as readonly string[]).includes(input.cardHeight)) {
    return `Invalid cardHeight value: ${input.cardHeight}. Must be one of: ${VALID_CARD_HEIGHT.join(', ')}`;
  }
  return null;
}

export function kanbanRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/api/kanban/boards', async (req, res, next) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      if (!projectId) { res.status(400).json({ error: 'projectId query param is required' }); return; }
      const boards = await services.kanbanBoardStore.listBoards(projectId);
      res.json(boards);
    } catch (err) { next(err); }
  });

  router.get('/api/kanban/boards/by-project/:projectId', async (req, res, next) => {
    try {
      const board = await services.kanbanBoardStore.getBoardByProject(req.params.projectId);
      res.json(board);
    } catch (err) { next(err); }
  });

  router.get('/api/kanban/boards/:id', async (req, res, next) => {
    try {
      const board = await services.kanbanBoardStore.getBoard(req.params.id);
      if (!board) { res.status(404).json({ error: 'Kanban board not found' }); return; }
      res.json(board);
    } catch (err) { next(err); }
  });

  router.post('/api/kanban/boards', async (req, res, next) => {
    try {
      const input = req.body as KanbanBoardCreateInput;
      if (!input.projectId || !input.name) {
        res.status(400).json({ error: 'projectId and name are required' });
        return;
      }
      const board = await services.kanbanBoardStore.createBoard(input);
      res.status(201).json(board);
    } catch (err) { next(err); }
  });

  router.put('/api/kanban/boards/:id', async (req, res, next) => {
    try {
      const input = req.body as KanbanBoardUpdateInput;
      const validationError = validateKanbanEnums(input);
      if (validationError) { res.status(400).json({ error: validationError }); return; }
      const board = await services.kanbanBoardStore.updateBoard(req.params.id, input);
      if (!board) { res.status(404).json({ error: 'Kanban board not found' }); return; }
      res.json(board);
    } catch (err) { next(err); }
  });

  router.delete('/api/kanban/boards/:id', async (req, res, next) => {
    try {
      const deleted = await services.kanbanBoardStore.deleteBoard(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Kanban board not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
