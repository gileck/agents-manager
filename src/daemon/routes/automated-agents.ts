import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { AutomatedAgentCreateInput, AutomatedAgentUpdateInput } from '../../shared/types';
import type { WsHolder } from '../server';
import { WS_CHANNELS } from '../ws/channels';
import { AUTOMATED_AGENT_TEMPLATES } from '../../core/data/automated-agent-templates';

export function automatedAgentRoutes(services: AppServices, wsHolder: WsHolder): Router {
  const router = Router();

  // Templates
  router.get('/api/automated-agents/templates', (_req, res) => {
    res.json(AUTOMATED_AGENT_TEMPLATES);
  });

  // List agents (optional project filter)
  router.get('/api/automated-agents', async (req, res, next) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      const agents = await services.automatedAgentStore.listAgents(projectId);
      res.json(agents);
    } catch (err) { next(err); }
  });

  // Get single agent
  router.get('/api/automated-agents/:id', async (req, res, next) => {
    try {
      const agent = await services.automatedAgentStore.getAgent(req.params.id);
      if (!agent) { res.status(404).json({ error: 'Automated agent not found' }); return; }
      res.json(agent);
    } catch (err) { next(err); }
  });

  // Create agent
  router.post('/api/automated-agents', async (req, res, next) => {
    try {
      const input = req.body as AutomatedAgentCreateInput;
      if (!input.projectId || !input.name || !input.schedule || !input.promptInstructions) {
        res.status(400).json({ error: 'projectId, name, schedule, and promptInstructions are required' });
        return;
      }
      const agent = await services.automatedAgentStore.createAgent(input);
      res.status(201).json(agent);
    } catch (err) { next(err); }
  });

  // Update agent
  router.put('/api/automated-agents/:id', async (req, res, next) => {
    try {
      const input = req.body as AutomatedAgentUpdateInput;
      const agent = await services.automatedAgentStore.updateAgent(req.params.id, input);
      if (!agent) { res.status(404).json({ error: 'Automated agent not found' }); return; }
      res.json(agent);
    } catch (err) { next(err); }
  });

  // Delete agent
  router.delete('/api/automated-agents/:id', async (req, res, next) => {
    try {
      const deleted = await services.automatedAgentStore.deleteAgent(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Automated agent not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // Manual trigger
  router.post('/api/automated-agents/:id/trigger', async (req, res, next) => {
    try {
      const agent = await services.automatedAgentStore.getAgent(req.params.id);
      if (!agent) { res.status(404).json({ error: 'Automated agent not found' }); return; }
      const ws = wsHolder.server;
      const taskId = `__auto__:${agent.id}`;
      const run = await services.scheduledAgentService.triggerRun(
        agent, 'manual',
        (chunk) => ws?.broadcast(WS_CHANNELS.AGENT_OUTPUT, taskId, chunk),
        (msg) => ws?.broadcast(WS_CHANNELS.AGENT_MESSAGE, taskId, msg),
      );
      res.json(run);
    } catch (err) { next(err); }
  });

  // Run history
  router.get('/api/automated-agents/:id/runs', async (req, res, next) => {
    try {
      const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const limit = isNaN(rawLimit) || rawLimit <= 0 ? 50 : rawLimit;
      const runs = await services.agentRunStore.getRunsForAutomatedAgent(req.params.id, limit);
      res.json(runs);
    } catch (err) { next(err); }
  });

  return router;
}
