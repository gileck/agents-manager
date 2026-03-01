import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type {
  TaskEventFilter, TaskEventCategory, TaskEventSeverity,
  ActivityFilter, ActivityAction, ActivityEntity,
} from '../../shared/types';

export function eventRoutes(services: AppServices): Router {
  const router = Router();

  // ============================================
  // Task Events
  // ============================================

  router.get('/api/events', async (req, res, next) => {
    try {
      const filter: TaskEventFilter = {};
      if (req.query.taskId) filter.taskId = req.query.taskId as string;
      if (req.query.category) filter.category = req.query.category as TaskEventCategory;
      if (req.query.severity) filter.severity = req.query.severity as TaskEventSeverity;
      if (req.query.since) filter.since = Number(req.query.since);
      if (req.query.until) filter.until = Number(req.query.until);
      if (req.query.limit) filter.limit = Number(req.query.limit);
      const events = await services.taskEventLog.getEvents(filter);
      res.json(events);
    } catch (err) { next(err); }
  });

  // ============================================
  // Activity Log
  // ============================================

  router.get('/api/activities', async (req, res, next) => {
    try {
      const filter: ActivityFilter = {};
      if (req.query.action) filter.action = req.query.action as ActivityAction;
      if (req.query.entityType) filter.entityType = req.query.entityType as ActivityEntity;
      if (req.query.entityId) filter.entityId = req.query.entityId as string;
      if (req.query.projectId) filter.projectId = req.query.projectId as string;
      if (req.query.since) filter.since = Number(req.query.since);
      if (req.query.until) filter.until = Number(req.query.until);
      if (req.query.limit) filter.limit = Number(req.query.limit);
      const entries = await services.activityLog.getEntries(filter);
      res.json(entries);
    } catch (err) { next(err); }
  });

  // ============================================
  // Debug Timeline
  // ============================================

  router.get('/api/tasks/:id/timeline', (req, res, next) => {
    try {
      const timeline = services.timelineService.getTimeline(req.params.id);
      res.json(timeline);
    } catch (err) { next(err); }
  });

  return router;
}
