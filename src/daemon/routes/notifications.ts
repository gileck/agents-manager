import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { InAppNotificationFilter } from '../../shared/types';

export function notificationRoutes(services: AppServices): Router {
  const router = Router();

  // GET /api/notifications — list notifications
  router.get('/api/notifications', async (req, res, next) => {
    try {
      const { projectId, unreadOnly, limit } = req.query as {
        projectId?: string;
        unreadOnly?: string;
        limit?: string;
      };
      const filter: InAppNotificationFilter = {};
      if (projectId) filter.projectId = projectId;
      if (unreadOnly === 'true') filter.unreadOnly = true;
      if (limit) filter.limit = parseInt(limit, 10);
      const notifications = await services.inAppNotificationStore.list(filter);
      res.json(notifications);
    } catch (err) { next(err); }
  });

  // GET /api/notifications/unread-count — get unread count
  router.get('/api/notifications/unread-count', async (req, res, next) => {
    try {
      const { projectId } = req.query as { projectId?: string };
      const count = await services.inAppNotificationStore.getUnreadCount(projectId);
      res.json({ count });
    } catch (err) { next(err); }
  });

  // PUT /api/notifications/read-all — mark all read
  router.put('/api/notifications/read-all', async (req, res, next) => {
    try {
      const { projectId } = req.query as { projectId?: string };
      await services.inAppNotificationStore.markAllRead(projectId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // PUT /api/notifications/:id/read — mark single notification as read
  router.put('/api/notifications/:id/read', async (req, res, next) => {
    try {
      const { id } = req.params;
      await services.inAppNotificationStore.markRead(id);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
