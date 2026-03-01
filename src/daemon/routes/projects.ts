import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { ProjectCreateInput, ProjectUpdateInput } from '../../shared/types';

export function projectRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/api/projects', async (_req, res, next) => {
    try {
      const projects = await services.projectStore.listProjects();
      res.json(projects);
    } catch (err) { next(err); }
  });

  router.get('/api/projects/:id', async (req, res, next) => {
    try {
      const project = await services.projectStore.getProject(req.params.id);
      if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
      res.json(project);
    } catch (err) { next(err); }
  });

  router.post('/api/projects', async (req, res, next) => {
    try {
      const input = req.body as ProjectCreateInput;
      if (!input.name) { res.status(400).json({ error: 'name is required' }); return; }
      const project = await services.projectStore.createProject(input);
      res.status(201).json(project);
    } catch (err) { next(err); }
  });

  router.put('/api/projects/:id', async (req, res, next) => {
    try {
      const input = req.body as ProjectUpdateInput;
      const project = await services.projectStore.updateProject(req.params.id, input);
      if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
      res.json(project);
    } catch (err) { next(err); }
  });

  router.delete('/api/projects/:id', async (req, res, next) => {
    try {
      const deleted = await services.projectStore.deleteProject(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Project not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
