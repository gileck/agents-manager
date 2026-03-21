import type { ChatMessage, AgentChatMessage, ChatImageRef } from './types';

/**
 * Converts raw DB chat messages into typed AgentChatMessages for rendering.
 *
 * Each DB row has a role (user | system | assistant) and a plain-text or JSON
 * content field.  This function maps them into the discriminated union used by
 * the React renderer (user, notification, status, assistant_text, etc.).
 *
 * Notification de-duplication:
 *   `deliverInjectedMessage` stores a `system` role message with a JSON
 *   envelope (`metadata.injected === true`).  `triggerNotificationTurn` then
 *   stores a `user` role message prefixed with `[System Notification]` as the
 *   agent turn trigger.  Only the system-role message is rendered as a
 *   notification — the user-role trigger message is silently hidden.
 */
export function convertDbMessages(dbMessages: ChatMessage[]): AgentChatMessage[] {
  const result: AgentChatMessage[] = [];
  for (const msg of dbMessages) {
    if (msg.role === 'user') {
      // Parse JSON envelope for messages with images
      let text = msg.content;
      let images: ChatImageRef[] | undefined;
      if (msg.content.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
            text = parsed.text;
            if (Array.isArray(parsed.images) && parsed.images.length > 0) {
              images = parsed.images as ChatImageRef[];
            }
          }
        } catch (err) {
          console.warn('[convertDbMessages] User message starts with { but failed JSON parse:', err);
        }
      }
      // Hide injected notification trigger messages (from triggerNotificationTurn).
      // The canonical notification is the system-role message from deliverInjectedMessage.
      if (text.startsWith('[System Notification]')) {
        continue;
      }
      result.push({ type: 'user' as const, text, images, timestamp: msg.createdAt });
    } else if (msg.role === 'system') {
      // Detect injected system notification JSON (from deliverInjectedMessage)
      if (msg.content.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed?.metadata?.injected === true && typeof parsed.text === 'string') {
            const taskTitle = typeof parsed.metadata.taskTitle === 'string' ? parsed.metadata.taskTitle : undefined;
            result.push({
              type: 'notification' as const,
              title: taskTitle ? `Task "${taskTitle}" completed` : 'System Notification',
              body: parsed.text,
              timestamp: msg.createdAt,
            });
            continue;
          }
        } catch { /* not injected notification JSON — fall through */ }
      }
      result.push({ type: 'status' as const, status: 'completed' as const, message: msg.content, timestamp: msg.createdAt });
    } else if (msg.role === 'assistant') {
      // Try to parse JSON array of structured messages; fall back to legacy plain text
      try {
        const parsed = JSON.parse(msg.content);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.type) {
          result.push(...(parsed as AgentChatMessage[]));
          continue;
        }
      } catch { /* legacy plain text */ }
      result.push({ type: 'assistant_text' as const, text: msg.content, timestamp: msg.createdAt });
    }
  }
  return result;
}
