import { describe, it, expect } from 'vitest';
import { convertDbMessages } from '../../src/shared/convert-db-messages';
import type { ChatMessage } from '../../src/shared/types';

/** Helper to build a minimal ChatMessage with defaults for cost fields. */
function makeMsg(overrides: Pick<ChatMessage, 'role' | 'content'> & Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    createdAt: Date.now(),
    costInputTokens: null,
    costOutputTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    totalCostUsd: null,
    lastContextInputTokens: null,
    ...overrides,
  };
}

describe('convertDbMessages', () => {
  it('returns empty array for empty input', () => {
    expect(convertDbMessages([])).toEqual([]);
  });

  it('converts a regular user message', () => {
    const result = convertDbMessages([
      makeMsg({ role: 'user', content: 'Hello' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'user', text: 'Hello' });
  });

  it('converts a user message with JSON image envelope', () => {
    const envelope = JSON.stringify({
      text: 'Check this image',
      images: [{ path: '/tmp/img.png', mimeType: 'image/png' }],
    });
    const result = convertDbMessages([makeMsg({ role: 'user', content: envelope })]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'user', text: 'Check this image' });
    if (result[0].type === 'user') {
      expect(result[0].images).toHaveLength(1);
    }
  });

  it('converts assistant plain text', () => {
    const result = convertDbMessages([makeMsg({ role: 'assistant', content: 'Sure thing' })]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'assistant_text', text: 'Sure thing' });
  });

  it('converts assistant JSON array of structured messages', () => {
    const structured = JSON.stringify([
      { type: 'assistant_text', text: 'Line 1', timestamp: 1 },
      { type: 'tool_use', toolName: 'read', input: 'foo', timestamp: 2 },
    ]);
    const result = convertDbMessages([makeMsg({ role: 'assistant', content: structured })]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'assistant_text', text: 'Line 1' });
    expect(result[1]).toMatchObject({ type: 'tool_use', toolName: 'read' });
  });

  it('converts a system status message', () => {
    const result = convertDbMessages([makeMsg({ role: 'system', content: 'Agent completed' })]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'status', message: 'Agent completed' });
  });

  describe('notification de-duplication', () => {
    const systemNotificationContent = JSON.stringify({
      text: 'Agent implementor completed with outcome "success".',
      metadata: {
        injected: true,
        taskTitle: 'Fix login bug',
      },
    });

    const userTriggerContent = '[System Notification] Agent implementor completed with outcome "success".';

    it('renders the system-role injected message as a notification', () => {
      const result = convertDbMessages([
        makeMsg({ id: 'sys-1', role: 'system', content: systemNotificationContent }),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'notification',
        title: 'Task "Fix login bug" completed',
        body: 'Agent implementor completed with outcome "success".',
      });
    });

    it('hides the user-role [System Notification] trigger message', () => {
      const result = convertDbMessages([
        makeMsg({ id: 'usr-1', role: 'user', content: userTriggerContent }),
      ]);
      expect(result).toHaveLength(0);
    });

    it('produces exactly ONE notification when both system and user messages exist', () => {
      const result = convertDbMessages([
        makeMsg({ id: 'sys-1', role: 'system', content: systemNotificationContent }),
        makeMsg({ id: 'usr-1', role: 'user', content: userTriggerContent }),
      ]);

      const notifications = result.filter((m) => m.type === 'notification');
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        type: 'notification',
        title: 'Task "Fix login bug" completed',
        body: 'Agent implementor completed with outcome "success".',
      });

      // The user trigger message should not appear at all
      const userMessages = result.filter((m) => m.type === 'user');
      expect(userMessages).toHaveLength(0);
    });

    it('still produces ONE notification regardless of message order', () => {
      // User trigger arrives before system message (order varies by timing)
      const result = convertDbMessages([
        makeMsg({ id: 'usr-1', role: 'user', content: userTriggerContent }),
        makeMsg({ id: 'sys-1', role: 'system', content: systemNotificationContent }),
      ]);

      const notifications = result.filter((m) => m.type === 'notification');
      expect(notifications).toHaveLength(1);
      expect(result).toHaveLength(1);
    });

    it('renders notification with fallback title when taskTitle is missing', () => {
      const content = JSON.stringify({
        text: 'Something happened',
        metadata: { injected: true },
      });
      const result = convertDbMessages([
        makeMsg({ role: 'system', content }),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'notification',
        title: 'System Notification',
        body: 'Something happened',
      });
    });
  });
});
