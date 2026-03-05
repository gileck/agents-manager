import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { TaskCreateInput, TaskUpdateInput, TaskFilter } from '../../shared/types';

export function taskRoutes(services: AppServices): Router {
  const router = Router();

  // ============================================
  // Task CRUD
  // ============================================

  router.get('/api/tasks', async (req, res, next) => {
    try {
      const filter: TaskFilter = {};
      if (req.query.projectId) filter.projectId = req.query.projectId as string;
      if (req.query.pipelineId) filter.pipelineId = req.query.pipelineId as string;
      if (req.query.status) filter.status = req.query.status as string;
      if (req.query.type) filter.type = req.query.type as TaskFilter['type'];
      if (req.query.size) filter.size = req.query.size as TaskFilter['size'];
      if (req.query.complexity) filter.complexity = req.query.complexity as TaskFilter['complexity'];
      if (req.query.priority) filter.priority = Number(req.query.priority);
      if (req.query.assignee) filter.assignee = req.query.assignee as string;
      if (req.query.parentTaskId !== undefined) filter.parentTaskId = (req.query.parentTaskId as string) || null;
      if (req.query.featureId !== undefined) filter.featureId = (req.query.featureId as string) || null;
      if (req.query.tag) filter.tag = req.query.tag as string;
      if (req.query.search) filter.search = req.query.search as string;
      const tasks = await services.taskStore.listTasks(filter);
      res.json(tasks);
    } catch (err) { next(err); }
  });

  router.get('/api/tasks/:id', async (req, res, next) => {
    try {
      const task = await services.taskStore.getTask(req.params.id);
      if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
      res.json(task);
    } catch (err) { next(err); }
  });

  router.post('/api/tasks', async (req, res, next) => {
    try {
      const input = req.body as TaskCreateInput;
      if (!input.projectId || !input.pipelineId || !input.title) {
        res.status(400).json({ error: 'projectId, pipelineId, and title are required' });
        return;
      }
      const task = await services.workflowService.createTask(input);
      res.status(201).json(task);
    } catch (err) { next(err); }
  });

  router.put('/api/tasks/:id', async (req, res, next) => {
    try {
      const input = req.body as TaskUpdateInput;
      // Strip status to prevent bypassing pipeline transitions via direct update
      const { status: _status, ...safeInput } = input;
      const task = await services.workflowService.updateTask(req.params.id, safeInput);
      if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
      res.json(task);
    } catch (err) { next(err); }
  });

  router.delete('/api/tasks/:id', async (req, res, next) => {
    try {
      const deleted = await services.workflowService.deleteTask(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Task not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ============================================
  // Task Reset
  // ============================================

  router.post('/api/tasks/:id/reset', async (req, res, next) => {
    try {
      const pipelineId = req.body.pipelineId as string | undefined;
      const task = await services.workflowService.resetTask(req.params.id, pipelineId);
      if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
      res.json(task);
    } catch (err) { next(err); }
  });

  // ============================================
  // Task Transitions
  // ============================================

  router.post('/api/tasks/:id/transition', async (req, res, next) => {
    try {
      const { toStatus, actor } = req.body as { toStatus?: string; actor?: string };
      if (!toStatus) { res.status(400).json({ error: 'toStatus is required' }); return; }
      const result = await services.workflowService.transitionTask(req.params.id, toStatus, actor);
      res.json(result);
    } catch (err) { next(err); }
  });

  router.post('/api/tasks/:id/force-transition', async (req, res, next) => {
    try {
      const { toStatus, actor } = req.body as { toStatus?: string; actor?: string };
      if (!toStatus) { res.status(400).json({ error: 'toStatus is required' }); return; }
      const result = await services.workflowService.forceTransitionTask(req.params.id, toStatus, actor);
      res.json(result);
    } catch (err) { next(err); }
  });

  router.get('/api/tasks/:id/transitions', async (req, res, next) => {
    try {
      const task = await services.taskStore.getTask(req.params.id);
      if (!task) { res.json([]); return; }
      const transitions = await services.pipelineEngine.getValidTransitions(task, 'manual');

      // De-duplicate transitions with the same label by pre-checking guards.
      // When multiple transitions share a label (e.g. guarded "Approve" → done
      // vs unguarded "Approve" → ready_to_merge), only show the first one whose
      // guards pass, so the UI renders a single button.
      const labelCounts = new Map<string, number>();
      for (const t of transitions) {
        const key = t.label ?? t.to;
        labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
      }

      const seenLabels = new Set<string>();
      const filtered = [];
      for (const t of transitions) {
        const key = t.label ?? t.to;
        if (seenLabels.has(key)) {
          continue;
        }
        // Only pre-check guards when there are duplicate labels to resolve
        if ((labelCounts.get(key) ?? 0) > 1 && t.guards && t.guards.length > 0) {
          const check = await services.pipelineEngine.checkGuards(task, t.to, 'manual');
          if (check && !check.canTransition) {
            continue;
          }
        }
        seenLabels.add(key);
        filtered.push(t);
      }

      res.json(filtered);
    } catch (err) { next(err); }
  });

  router.get('/api/tasks/:id/all-transitions', async (req, res, next) => {
    try {
      const task = await services.taskStore.getTask(req.params.id);
      if (!task) { res.json({ manual: [], agent: [], system: [] }); return; }
      const transitions = await services.pipelineEngine.getAllTransitions(task);
      res.json(transitions);
    } catch (err) { next(err); }
  });

  router.post('/api/tasks/:id/guard-check', async (req, res, next) => {
    try {
      const { toStatus, trigger } = req.body as { toStatus?: string; trigger?: string };
      if (!toStatus || !trigger) {
        res.status(400).json({ error: 'toStatus and trigger are required' });
        return;
      }
      const task = await services.taskStore.getTask(req.params.id);
      if (!task) { res.json(null); return; }
      const result = await services.pipelineEngine.checkGuards(
        task, toStatus, trigger as 'manual' | 'agent' | 'system',
      );
      res.json(result);
    } catch (err) { next(err); }
  });

  // ============================================
  // Pipeline Diagnostics & Hook Retry
  // ============================================

  router.get('/api/tasks/:id/pipeline-diagnostics', async (req, res, next) => {
    try {
      const diagnostics = await services.pipelineInspectionService.getPipelineDiagnostics(req.params.id);
      res.json(diagnostics);
    } catch (err) { next(err); }
  });

  router.post('/api/tasks/:id/hook-retry', async (req, res, next) => {
    try {
      const { hookName, transitionFrom, transitionTo } = req.body as {
        hookName?: string; transitionFrom?: string; transitionTo?: string;
      };
      if (!hookName) { res.status(400).json({ error: 'hookName is required' }); return; }
      const result = await services.pipelineInspectionService.retryHook(
        req.params.id, hookName, transitionFrom, transitionTo,
      );
      res.json(result);
    } catch (err) { next(err); }
  });

  router.post('/api/tasks/:id/advance-phase', async (req, res, next) => {
    try {
      const result = await services.pipelineInspectionService.advancePhase(req.params.id);
      res.json(result);
    } catch (err) { next(err); }
  });

  // ============================================
  // Dependencies
  // ============================================

  router.get('/api/tasks/:id/dependencies', async (req, res, next) => {
    try {
      const deps = await services.taskStore.getDependencies(req.params.id);
      res.json(deps);
    } catch (err) { next(err); }
  });

  router.get('/api/tasks/:id/dependents', async (req, res, next) => {
    try {
      const deps = await services.taskStore.getDependents(req.params.id);
      res.json(deps);
    } catch (err) { next(err); }
  });

  router.post('/api/tasks/:id/dependencies', async (req, res, next) => {
    try {
      const { dependsOnTaskId } = req.body as { dependsOnTaskId?: string };
      if (!dependsOnTaskId) {
        res.status(400).json({ error: 'dependsOnTaskId is required' });
        return;
      }
      await services.taskStore.addDependency(req.params.id, dependsOnTaskId);
      res.status(201).json({ taskId: req.params.id, dependsOnTaskId });
    } catch (err) { next(err); }
  });

  router.delete('/api/tasks/:id/dependencies/:depId', async (req, res, next) => {
    try {
      await services.taskStore.removeDependency(req.params.id, req.params.depId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ============================================
  // Prompts
  // ============================================

  router.get('/api/tasks/:id/prompts', async (req, res, next) => {
    try {
      const prompts = await services.pendingPromptStore.getPendingForTask(req.params.id);
      res.json(prompts);
    } catch (err) { next(err); }
  });

  // ============================================
  // Context Entries & Feedback
  // ============================================

  router.get('/api/tasks/:id/context', async (req, res, next) => {
    try {
      const entries = await services.taskContextStore.getEntriesForTask(req.params.id);
      res.json(entries);
    } catch (err) { next(err); }
  });

  router.post('/api/tasks/:id/context', async (req, res, next) => {
    try {
      const { source, entryType, summary, data } = req.body as {
        source?: string; entryType?: string; summary?: string; data?: Record<string, unknown>;
      };
      if (!source || !entryType || !summary) {
        res.status(400).json({ error: 'source, entryType, and summary are required' });
        return;
      }
      const entry = await services.workflowService.addContextEntry(req.params.id, {
        source, entryType, summary, data,
      });
      res.status(201).json(entry);
    } catch (err) { next(err); }
  });

  router.post('/api/tasks/:id/feedback', async (req, res, next) => {
    try {
      const { entryType, content, source, agentRunId } = req.body as { entryType?: string; content?: string; source?: string; agentRunId?: string };
      if (!entryType || !content) {
        res.status(400).json({ error: 'entryType and content are required' });
        return;
      }
      const entry = await services.workflowService.addTaskFeedback(req.params.id, entryType, content, source, agentRunId);
      res.status(201).json(entry);
    } catch (err) { next(err); }
  });

  // ============================================
  // Worktree
  // ============================================

  router.get('/api/tasks/:id/worktree', async (req, res, next) => {
    try {
      const task = await services.taskStore.getTask(req.params.id);
      if (!task) { res.json(null); return; }
      const project = await services.projectStore.getProject(task.projectId);
      if (!project?.path) { res.json(null); return; }
      const wm = services.createWorktreeManager(project.path);
      const worktree = await wm.get(req.params.id);
      res.json(worktree);
    } catch (err) { next(err); }
  });

  return router;
}
