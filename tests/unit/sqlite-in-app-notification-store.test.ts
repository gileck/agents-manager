import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../helpers/test-context';
import { SqliteInAppNotificationStore } from '../../src/core/stores/sqlite-in-app-notification-store';
import type { InAppNotificationCreateInput } from '../../src/shared/types';

function makeStore() {
  const db = new Database(':memory:');
  applyMigrations(db);
  db.pragma('foreign_keys = ON');
  return new SqliteInAppNotificationStore(db);
}

const base: InAppNotificationCreateInput = {
  taskId: 'task-1',
  projectId: 'proj-1',
  title: 'Test Title',
  body: 'Test body text',
  navigationUrl: '/tasks/task-1',
};

describe('SqliteInAppNotificationStore', () => {
  let store: SqliteInAppNotificationStore;

  beforeEach(() => {
    store = makeStore();
  });

  describe('add', () => {
    it('persists a notification and returns it with an id', async () => {
      const n = await store.add(base);
      expect(n.id).toBeTruthy();
      expect(n.taskId).toBe('task-1');
      expect(n.projectId).toBe('proj-1');
      expect(n.title).toBe('Test Title');
      expect(n.body).toBe('Test body text');
      expect(n.navigationUrl).toBe('/tasks/task-1');
      expect(n.read).toBe(false);
      expect(typeof n.createdAt).toBe('number');
    });

    it('stores notifications without a projectId (null)', async () => {
      const n = await store.add({ ...base, projectId: undefined });
      expect(n.projectId).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all notifications (both are present)', async () => {
      await store.add({ ...base, taskId: 'task-1', title: 'A' });
      await store.add({ ...base, taskId: 'task-2', title: 'B' });
      const results = await store.list();
      expect(results).toHaveLength(2);
      const titles = results.map(r => r.title);
      expect(titles).toContain('A');
      expect(titles).toContain('B');
    });

    it('filters by projectId', async () => {
      await store.add({ ...base, projectId: 'proj-1', title: 'P1' });
      await store.add({ ...base, projectId: 'proj-2', title: 'P2' });
      const results = await store.list({ projectId: 'proj-1' });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('P1');
    });

    it('filters unread only', async () => {
      const n = await store.add({ ...base, title: 'Unread' });
      await store.add({ ...base, title: 'Also unread' });
      await store.markRead(n.id);
      const results = await store.list({ unreadOnly: true });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Also unread');
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.add({ ...base, taskId: `task-${i}` });
      }
      const results = await store.list({ limit: 3 });
      expect(results).toHaveLength(3);
    });

    it('combines projectId and unreadOnly filters', async () => {
      await store.add({ ...base, projectId: 'proj-1', title: 'Read P1' }).then(n => store.markRead(n.id));
      await store.add({ ...base, projectId: 'proj-1', title: 'Unread P1' });
      await store.add({ ...base, projectId: 'proj-2', title: 'Unread P2' });
      const results = await store.list({ projectId: 'proj-1', unreadOnly: true });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Unread P1');
    });
  });

  describe('markRead', () => {
    it('marks a single notification as read', async () => {
      const n = await store.add(base);
      expect(n.read).toBe(false);
      await store.markRead(n.id);
      const [updated] = await store.list();
      expect(updated.read).toBe(true);
    });

    it('only marks the target notification as read', async () => {
      const n1 = await store.add({ ...base, taskId: 'task-1' });
      await store.add({ ...base, taskId: 'task-2' });
      await store.markRead(n1.id);
      const results = await store.list();
      const readItems = results.filter(n => n.read);
      expect(readItems).toHaveLength(1);
      expect(readItems[0].id).toBe(n1.id);
    });
  });

  describe('markAllRead', () => {
    it('marks all notifications as read when no projectId given', async () => {
      await store.add({ ...base, projectId: 'proj-1', taskId: 'task-1' });
      await store.add({ ...base, projectId: 'proj-2', taskId: 'task-2' });
      await store.markAllRead();
      const results = await store.list();
      expect(results.every(n => n.read)).toBe(true);
    });

    it('marks only notifications for the specified project as read', async () => {
      await store.add({ ...base, projectId: 'proj-1', taskId: 'task-1' });
      await store.add({ ...base, projectId: 'proj-2', taskId: 'task-2' });
      await store.markAllRead('proj-1');
      const proj1 = await store.list({ projectId: 'proj-1' });
      const proj2 = await store.list({ projectId: 'proj-2' });
      expect(proj1.every(n => n.read)).toBe(true);
      expect(proj2.every(n => !n.read)).toBe(true);
    });
  });

  describe('getUnreadCount', () => {
    it('returns total unread count without a projectId', async () => {
      await store.add({ ...base, projectId: 'proj-1', taskId: 'task-1' });
      await store.add({ ...base, projectId: 'proj-2', taskId: 'task-2' });
      await store.add({ ...base, taskId: 'task-3' }).then(n => store.markRead(n.id));
      expect(await store.getUnreadCount()).toBe(2);
    });

    it('returns scoped unread count for a projectId', async () => {
      await store.add({ ...base, projectId: 'proj-1', taskId: 'task-1' });
      await store.add({ ...base, projectId: 'proj-1', taskId: 'task-2' }).then(n => store.markRead(n.id));
      await store.add({ ...base, projectId: 'proj-2', taskId: 'task-3' });
      expect(await store.getUnreadCount('proj-1')).toBe(1);
    });

    it('returns 0 when all notifications are read', async () => {
      const n = await store.add(base);
      await store.markRead(n.id);
      expect(await store.getUnreadCount()).toBe(0);
    });
  });
});
