import { describe, it, expect, vi } from 'vitest';
import { MultiChannelNotificationRouter } from '../../src/core/services/multi-channel-notification-router';
import type { INotificationRouter } from '../../src/core/interfaces/notification-router';
import type { Notification } from '../../src/shared/types';

function createStubRouter(name?: string): INotificationRouter & { calls: Notification[] } {
  const calls: Notification[] = [];
  const router: INotificationRouter & { calls: Notification[] } = {
    calls,
    async send(notification: Notification): Promise<void> {
      calls.push(notification);
    },
  };
  if (name) {
    Object.defineProperty(router.constructor, 'name', { value: name });
  }
  return router;
}

function createFailingRouter(error: Error): INotificationRouter {
  return {
    async send(): Promise<void> {
      throw error;
    },
  };
}

const sampleNotification: Notification = {
  taskId: 'task-1',
  title: 'Test',
  body: 'Test body',
  channel: 'test-channel',
};

describe('MultiChannelNotificationRouter', () => {
  it('dispatches notification to all registered channels', async () => {
    const router = new MultiChannelNotificationRouter();
    const channelA = createStubRouter();
    const channelB = createStubRouter();

    router.addRouter(channelA);
    router.addRouter(channelB);

    await router.send(sampleNotification);

    expect(channelA.calls).toHaveLength(1);
    expect(channelA.calls[0]).toEqual(sampleNotification);
    expect(channelB.calls).toHaveLength(1);
    expect(channelB.calls[0]).toEqual(sampleNotification);
  });

  it('isolates failures: one channel failure does not affect others', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const router = new MultiChannelNotificationRouter();
    const healthy = createStubRouter();
    const failing = createFailingRouter(new Error('channel down'));

    router.addRouter(failing);
    router.addRouter(healthy);

    await router.send(sampleNotification);

    // Healthy channel still received the notification
    expect(healthy.calls).toHaveLength(1);
    expect(healthy.calls[0]).toEqual(sampleNotification);

    // Error was logged with structured context
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logArgs = consoleErrorSpy.mock.calls[0];
    expect(logArgs[0]).toContain('[notification-router]');
    expect(logArgs[0]).toContain('task-1');

    consoleErrorSpy.mockRestore();
  });

  it('supports add and remove lifecycle', async () => {
    const router = new MultiChannelNotificationRouter();
    const channelA = createStubRouter();
    const channelB = createStubRouter();

    router.addRouter(channelA);
    router.addRouter(channelB);

    await router.send(sampleNotification);
    expect(channelA.calls).toHaveLength(1);
    expect(channelB.calls).toHaveLength(1);

    // Remove channelA and send again
    router.removeRouter(channelA);
    await router.send(sampleNotification);

    // channelA should not receive the second notification
    expect(channelA.calls).toHaveLength(1);
    // channelB should receive both
    expect(channelB.calls).toHaveLength(2);
  });

  it('handles empty router list without errors', async () => {
    const router = new MultiChannelNotificationRouter();
    // Should not throw
    await router.send(sampleNotification);
  });

  it('removing a non-existent router is a no-op', () => {
    const router = new MultiChannelNotificationRouter();
    const channel = createStubRouter();
    // Should not throw
    router.removeRouter(channel);
  });
});
