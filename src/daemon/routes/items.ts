import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { ItemCreateInput, ItemUpdateInput } from '../../shared/types';
import * as itemService from '../../core/services/item-service';

export function itemRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/api/items', (_req, res, next) => {
    try {
      const items = itemService.listItems(services.db);
      res.json(items);
    } catch (err) { next(err); }
  });

  router.get('/api/items/:id', (req, res, next) => {
    try {
      const item = itemService.getItem(services.db, req.params.id);
      if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
      res.json(item);
    } catch (err) { next(err); }
  });

  router.post('/api/items', (req, res, next) => {
    try {
      const input = req.body as ItemCreateInput;
      if (!input.name) { res.status(400).json({ error: 'name is required' }); return; }
      const item = itemService.createItem(services.db, input);
      res.status(201).json(item);
    } catch (err) { next(err); }
  });

  router.put('/api/items/:id', (req, res, next) => {
    try {
      const input = req.body as ItemUpdateInput;
      const item = itemService.updateItem(services.db, req.params.id, input);
      if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
      res.json(item);
    } catch (err) { next(err); }
  });

  router.delete('/api/items/:id', (req, res, next) => {
    try {
      const deleted = itemService.deleteItem(services.db, req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Item not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
