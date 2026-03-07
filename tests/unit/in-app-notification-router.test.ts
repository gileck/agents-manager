import { describe, it, expect, vi } from 'vitest';
import { InAppNotificationRouter } from '../../src/core/services/in-app-notification-router';
import type { IInAppNotificationStore } from '../../src/core/interfaces/in-app-notification-store';
import type { InAppNotification, InAppNotificationCreateInput, Notification } from '../../src/shared/types';

function makeStoredEntry(input: InAppNotificationCreateInput): InAppNotification {
  return {
    id: 'notif-1',
    taskId: input.taskId,
    projectId: input.projectId ?? null,
    title: input.title,
    body: input.body,
    navigationUrl: input.navigationUrl,
    read: false,
    createdAt: Date.now(),
  };
}

function makeStore(): IInAppNotificationStore & { lastAdd: InAppNotificationCreateInput | null } {
  let lastAdd: InAppNotificationCreateInput | null = null;
  return {
    get lastAdd() { return lastAdd; },
    async add(input) {
      lastAdd = input;
      return makeStoredEntry(input);
    },
    async list() { return []; },
    async markRead() {},
    async markAllRead() {},
    async getUnreadCount() { return 0; },
  };
}

const baseNotification: Notification = {
  taskId: 'task-abc',
  projectId: 'proj-xyz',
  title: 'Plan ready for review',
  body: 'Task has moved to plan_review',
  channel: 'pipeline',
  navigationUrl: '/tasks/task-abc/plan',
};

describe('InAppNotificationRouter', () => {
  it('calls store.add with taskId, projectId, title, body, and navigationUrl', async () => {
    const store = makeStore();
    const emitWs = vi.fn();
    const router = new InAppNotificationRouter(store, emitWs);

    await router.send(baseNotification);

    expect(store.lastAdd).toMatchObject({
      taskId: 'task-abc',
      projectId: 'proj-xyz',
      title: 'Plan ready for review',
      body: 'Task has moved to plan_review',
      navigationUrl: '/tasks/task-abc/plan',
    });
  });

  it('falls back to /tasks/:taskId when navigationUrl is omitted', async () => {
    const store = makeStore();
    const emitWs = vi.fn();
    const router = new InAppNotificationRouter(store, emitWs);
    const { navigationUrl: _, ...withoutUrl } = baseNotification;

    await router.send(withoutUrl);

    expect(store.lastAdd!.navigationUrl).toBe(`/tasks/${baseNotification.taskId}`);
  });

  it('passes undefined projectId when notification has no projectId', async () => {
    const store = makeStore();
    const emitWs = vi.fn();
    const router = new InAppNotificationRouter(store, emitWs);
    const { projectId: _, ...withoutProject } = baseNotification;

    await router.send(withoutProject);

    expect(store.lastAdd!.projectId).toBeUndefined();
  });

  it('broadcasts the stored entry via emitWs after storing', async () => {
    const store = makeStore();
    const emitWs = vi.fn();
    const router = new InAppNotificationRouter(store, emitWs);

    await router.send(baseNotification);

    expect(emitWs).toHaveBeenCalledTimes(1);
    const [channel, payload] = emitWs.mock.calls[0];
    expect(channel).toBe('notification:added');
    expect((payload as InAppNotification).taskId).toBe('task-abc');
    expect((payload as InAppNotification).projectId).toBe('proj-xyz');
  });

  it('does not emit via WS if store.add throws', async () => {
    const failingStore: IInAppNotificationStore = {
      async add() { throw new Error('DB error'); },
      async list() { return []; },
      async markRead() {},
      async markAllRead() {},
      async getUnreadCount() { return 0; },
    };
    const emitWs = vi.fn();
    const router = new InAppNotificationRouter(failingStore, emitWs);

    await expect(router.send(baseNotification)).rejects.toThrow('DB error');
    expect(emitWs).not.toHaveBeenCalled();
  });
});
