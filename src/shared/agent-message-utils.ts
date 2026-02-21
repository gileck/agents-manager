import type { AgentChatMessage } from './types';

/**
 * Convert an array of AgentChatMessage[] into the raw text format
 * that the agent emit() function produces.
 *
 * Used both during live streaming (to derive the raw view from streamed messages)
 * and on page reload (to derive raw text from persisted messages).
 */
export function messagesToRawText(messages: AgentChatMessage[]): string {
  let result = '';
  for (const msg of messages) {
    switch (msg.type) {
      case 'assistant_text':
        result += msg.text + '\n';
        break;
      case 'tool_use':
        result += `\n> Tool: ${msg.toolName}\n> Input: ${msg.input}\n`;
        break;
      case 'tool_result':
        result += `[tool] ${msg.result}\n`;
        break;
      // Skip usage, status, user types — they don't appear in the raw text view
    }
  }
  return result;
}
