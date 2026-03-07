import { useState, useEffect, useCallback } from 'react';
import type { InAppNotification } from '../../shared/types';
import { reportError } from '../lib/error-handler';

export function useNotifications(projectId?: string) {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await window.api.notifications.list({ projectId, limit: 50 });
      setNotifications(data);
    } catch (err) {
      reportError(err, 'fetch notifications');
    }
  }, [projectId]);

  useEffect(() => {
    fetchNotifications();
    const unsub = window.api.on.notificationAdded(() => {
      fetchNotifications();
    });
    return () => { unsub(); };
  }, [fetchNotifications]);

  const markRead = useCallback(async (id: string) => {
    try {
      await window.api.notifications.markRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (err) {
      reportError(err, 'mark notification read');
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await window.api.notifications.markAllRead(projectId);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (err) {
      reportError(err, 'mark all notifications read');
    }
  }, [projectId]);

  return { notifications, unreadCount, markRead, markAllRead, refetch: fetchNotifications };
}
