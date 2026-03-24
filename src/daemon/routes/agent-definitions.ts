import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { AgentDefinitionCreateInput, AgentDefinitionUpdateInput, AgentMode, RevisionReason } from '../../shared/types';
import { initAgentFiles, showAgentConfig, deleteAgentFiles } from '../../core/agents/agent-file-config-writer';
import { AGENT_BUILDERS } from '../../core/agents/agent-builders';

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

  // ============================================
  // File-based Agent Config (.agents/) — must be registered before the
  // generic `:id` route so that `/effective`, `/init`, and `/file-config`
  // sub-paths are matched first.
  // ============================================

  /**
   * GET /api/agent-definitions/types/list
   * List all available agent types (from AGENT_BUILDERS).
   */
  router.get('/api/agent-definitions/types/list', (_req, res) => {
    res.json(Object.keys(AGENT_BUILDERS));
  });

  /**
   * GET /api/agent-definitions/:agentType/effective?projectId=X
   * Returns effective agent config with per-field source attribution.
   */
  router.get('/api/agent-definitions/:agentType/effective', async (req, res, next) => {
    try {
      const { agentType } = req.params;
      const projectId = req.query.projectId as string | undefined;
      const mode = (req.query.mode as AgentMode) || 'new';
      const revisionReason = req.query.revisionReason as RevisionReason | undefined;

      if (!AGENT_BUILDERS[agentType]) {
        res.status(400).json({ error: `Unknown agent type "${agentType}". Available: ${Object.keys(AGENT_BUILDERS).join(', ')}` });
        return;
      }

      if (!projectId) {
        res.status(400).json({ error: 'projectId query parameter is required' });
        return;
      }

      const project = await services.projectStore.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: `Project "${projectId}" not found` });
        return;
      }
      if (!project.path) {
        res.status(400).json({ error: `Project "${projectId}" has no path configured` });
        return;
      }

      const result = showAgentConfig(project.path, agentType, { mode, revisionReason });
      res.json({
        agentType,
        prompt: result.prompt,
        promptSource: result.promptSource,
        config: result.config,
        configSources: result.configSources,
        hasFileConfig: result.hasFileConfig,
      });
    } catch (err) { next(err); }
  });

  /**
   * POST /api/agent-definitions/:agentType/init?projectId=X
   * Scaffold `.agents/{agentType}/` with default prompt and config files.
   * Use agentType='all' to scaffold all agent types.
   * Body: { force?: boolean }
   */
  router.post('/api/agent-definitions/:agentType/init', async (req, res, next) => {
    try {
      const { agentType } = req.params;
      const projectId = req.query.projectId as string | undefined;
      const force = req.body?.force === true;

      if (!projectId) {
        res.status(400).json({ error: 'projectId query parameter is required' });
        return;
      }

      const project = await services.projectStore.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: `Project "${projectId}" not found` });
        return;
      }
      if (!project.path) {
        res.status(400).json({ error: `Project "${projectId}" has no path configured` });
        return;
      }

      const typeArg = agentType === 'all' ? undefined : agentType;
      const result = initAgentFiles(project.path, typeArg, { force });
      res.json(result);
    } catch (err) {
      // initAgentFiles throws for unknown agent types — return 400
      if (err instanceof Error && err.message.includes('Unknown agent type')) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  /**
   * DELETE /api/agent-definitions/:agentType/file-config?projectId=X
   * Delete `.agents/{agentType}/` files (reset to defaults).
   * Use agentType='all' to delete the entire `.agents/` directory.
   */
  router.delete('/api/agent-definitions/:agentType/file-config', async (req, res, next) => {
    try {
      const { agentType } = req.params;
      const projectId = req.query.projectId as string | undefined;

      if (!projectId) {
        res.status(400).json({ error: 'projectId query parameter is required' });
        return;
      }

      const project = await services.projectStore.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: `Project "${projectId}" not found` });
        return;
      }
      if (!project.path) {
        res.status(400).json({ error: `Project "${projectId}" has no path configured` });
        return;
      }

      const typeArg = agentType === 'all' ? undefined : agentType;
      const result = deleteAgentFiles(project.path, typeArg);
      res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unknown agent type')) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // ============================================
  // Agent Definitions CRUD (by ID) — after file-config routes
  // ============================================

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

  router.get('/api/agent-libs/features', (_req, res, next) => {
    try {
      const features = services.agentLibRegistry.getAllFeatures();
      res.json(features);
    } catch (err) { next(err); }
  });

  return router;
}
