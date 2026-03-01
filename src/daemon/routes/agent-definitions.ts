import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { AgentDefinitionCreateInput, AgentDefinitionUpdateInput } from '../../shared/types';

export function agentDefinitionRoutes(services: AppServices): Router {
  const router = Router();

  // ============================================
  // Agent Definitions CRUD
  // ============================================

  router.get('/api/agent-definitions', async (_req, res, next) => {
    try {
      const definitions = await services.agentDefinitionStore.listDefinitions();
      res.json(definitions);
    } catch (err) { next(err); }
  });

  router.get('/api/agent-definitions/:id', async (req, res, next) => {
    try {
      const definition = await services.agentDefinitionStore.getDefinition(req.params.id);
      if (!definition) { res.status(404).json({ error: 'Agent definition not found' }); return; }
      res.json(definition);
    } catch (err) { next(err); }
  });

  router.post('/api/agent-definitions', async (req, res, next) => {
    try {
      const input = req.body as AgentDefinitionCreateInput;
      if (!input.name || !input.engine) {
        res.status(400).json({ error: 'name and engine are required' });
        return;
      }
      const definition = await services.agentDefinitionStore.createDefinition(input);
      res.status(201).json(definition);
    } catch (err) { next(err); }
  });

  router.put('/api/agent-definitions/:id', async (req, res, next) => {
    try {
      const input = req.body as AgentDefinitionUpdateInput;
      const definition = await services.agentDefinitionStore.updateDefinition(req.params.id, input);
      if (!definition) { res.status(404).json({ error: 'Agent definition not found' }); return; }
      res.json(definition);
    } catch (err) { next(err); }
  });

  router.delete('/api/agent-definitions/:id', async (req, res, next) => {
    try {
      const deleted = await services.agentDefinitionStore.deleteDefinition(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Agent definition not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ============================================
  // Agent Libs (read-only)
  // ============================================

  router.get('/api/agent-libs', async (_req, res, next) => {
    try {
      const libs = await services.agentLibRegistry.getAvailableLibs();
      res.json(libs);
    } catch (err) { next(err); }
  });

  router.get('/api/agent-libs/models', (_req, res, next) => {
    try {
      const models = services.agentLibRegistry.getAllModels();
      res.json(models);
    } catch (err) { next(err); }
  });

  return router;
}
