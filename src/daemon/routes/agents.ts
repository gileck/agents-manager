import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { WsHolder } from '../server';
import { WS_CHANNELS } from '../ws/channels';

export function agentRoutes(services: AppServices, wsHolder: WsHolder): Router {
  const router = Router();

  // POST /api/tasks/:taskId/agent/start — DISABLED: direct agent start is not allowed.
  // Agents must be started via pipeline transitions (tasks transition / tasks start).
  router.post('/api/tasks/:taskId/agent/start', (_req, res) => {
    res.status(403).json({
      error: 'Direct agent start is disabled. Use pipeline transitions (tasks transition / tasks start) to trigger agent runs via the start_agent hook.',
    });
  });

  // POST /api/tasks/:taskId/agent/stop — stop agent
  router.post('/api/tasks/:taskId/agent/stop', async (req, res, next) => {
    try {
      const { runId } = req.body as { runId: string };
      if (!runId) {
        res.status(400).json({ error: 'runId is required in request body' });
        return;
      }
      const result = await services.workflowService.stopAgent(runId);
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/agent/message — send message to running agent
  router.post('/api/tasks/:taskId/agent/message', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { message } = req.body as { message: string };
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'message is required and must be a string' });
        return;
      }
      const ws = wsHolder.server;
      const run = await services.workflowService.resumeAgent(taskId, message, {
        onOutput: (chunk) => ws?.broadcast(WS_CHANNELS.AGENT_OUTPUT, taskId, chunk),
        onMessage: (msg) => ws?.broadcast(WS_CHANNELS.AGENT_MESSAGE, taskId, msg),
        onStatusChange: (status) => ws?.broadcast(WS_CHANNELS.AGENT_STATUS, taskId, status),
      });
      res.json(run ?? { ok: true });
    } catch (err) { next(err); }
  });

  // GET /api/tasks/:taskId/agent/runs — list agent runs for task
  router.get('/api/tasks/:taskId/agent/runs', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const runs = await services.agentRunStore.getRunsForTask(taskId);
      res.json(runs);
    } catch (err) { next(err); }
  });

  // POST /api/tasks/:taskId/agent/workflow-review — start workflow review agent
  router.post('/api/tasks/:taskId/agent/workflow-review', async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const result = await services.workflowService.startAgent(taskId, 'new', 'task-workflow-reviewer');
      res.json(result);
    } catch (err) { next(err); }
  });

  // GET /api/agent-runs/active — list active agent runs
  router.get('/api/agent-runs/active', async (_req, res, next) => {
    try {
      const runs = await services.agentRunStore.getActiveRuns();
      res.json(runs);
    } catch (err) { next(err); }
  });

  // GET /api/agent-runs/active-task-ids — unique task IDs with active runs
  router.get('/api/agent-runs/active-task-ids', async (_req, res, next) => {
    try {
      const runs = await services.agentRunStore.getActiveRuns();
      const taskIds = [...new Set(runs.map((r) => r.taskId))];
      res.json(taskIds);
    } catch (err) { next(err); }
  });

  // GET /api/agent-runs — list all agent runs
  router.get('/api/agent-runs', async (_req, res, next) => {
    try {
      const runs = await services.agentRunStore.getAllRuns();
      res.json(runs);
    } catch (err) { next(err); }
  });

  // GET /api/agent-runs/:runId — get single agent run
  router.get('/api/agent-runs/:runId', async (req, res, next) => {
    try {
      const { runId } = req.params;
      const run = await services.agentRunStore.getRun(runId);
      if (!run) {
        res.status(404).json({ error: 'Agent run not found' });
        return;
      }
      res.json(run);
    } catch (err) { next(err); }
  });

  // POST /api/agent-runs/:runId/diagnostics — compute diagnostics for a completed run
  router.post('/api/agent-runs/:runId/diagnostics', async (req, res, next) => {
    try {
      const { runId } = req.params;
      const updated = await services.workflowService.computeRunDiagnostics(runId);
      res.json(updated);
    } catch (err) { next(err); }
  });

  return router;
}
