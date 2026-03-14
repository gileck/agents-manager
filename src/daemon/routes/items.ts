import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { ItemCreateInput, ItemUpdateInput } from '../../shared/types';

export function itemRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/api/items', async (_req, res, next) => {
    try {
      const items = await services.itemStore.listItems();
      res.json(items);
    } catch (err) { next(err); }
  });

  router.get('/api/items/:id', async (req, res, next) => {
    try {
      const item = await services.itemStore.getItem(req.params.id);
      if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
      res.json(item);
    } catch (err) { next(err); }
  });

  router.post('/api/items', async (req, res, next) => {
    try {
      const input = req.body as ItemCreateInput;
      if (!input.name) { res.status(400).json({ error: 'name is required' }); return; }
      const item = await services.itemStore.createItem(input);
      res.status(201).json(item);
    } catch (err) { next(err); }
  });

  router.put('/api/items/:id', async (req, res, next) => {
    try {
      const input = req.body as ItemUpdateInput;
      const item = await services.itemStore.updateItem(req.params.id, input);
      if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
      res.json(item);
    } catch (err) { next(err); }
  });

  router.delete('/api/items/:id', async (req, res, next) => {
    try {
      const deleted = await services.itemStore.deleteItem(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Item not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
