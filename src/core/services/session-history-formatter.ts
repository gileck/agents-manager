import { createHash } from 'crypto';
import type { AgentChatMessage } from '../../shared/types';

const DEFAULT_MAX_CHARS = 80_000;

/**
 * Derives a deterministic UUID v4-shaped string from taskId + agentType.
 * Used as a stable session identifier across runs for the same task+agent.
 */
export function deriveSessionId(taskId: string, agentType: string): string {
  const hash = createHash('sha256').update(`${taskId}:${agentType}`).digest('hex');
  // Format as UUID v4 (with version nibble set to 4, variant bits set)
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Compresses agent chat messages into a text summary for prompt injection.
 * Used by non-native-resume libs (CursorAgentLib, CodexCliLib) to provide
 * prior session context.
 */
export class SessionHistoryFormatter {
  static format(messages: AgentChatMessage[], maxChars: number = DEFAULT_MAX_CHARS): string {
    const lines: string[] = [
      '## Previous Session',
      'Your previous work session is shown below. Use this context to avoid re-exploring.',
      '',
    ];

    for (const msg of messages) {
      switch (msg.type) {
        case 'assistant_text':
          lines.push(`[Assistant] ${msg.text}`);
          break;
        case 'thinking':
          lines.push(`[Thinking] ${msg.text}`);
          break;
        case 'user':
          lines.push(`[User] ${msg.text}`);
          break;
        case 'tool_use': {
          const truncInput = msg.input.length > 200 ? msg.input.slice(0, 200) + '...' : msg.input;
          lines.push(`[Tool: ${msg.toolName}] ${truncInput}`);
          break;
        }
        // Skip tool_result, usage, status — not useful for context
        default:
          break;
      }
    }

    let result = lines.join('\n');

    // Truncate if over budget: drop oldest messages but preserve last 10%
    if (result.length > maxChars) {
      const preserveChars = Math.floor(maxChars * 0.1);
      const headerEnd = result.indexOf('\n\n') + 2; // Keep the header
      const header = result.slice(0, headerEnd);
      const body = result.slice(headerEnd);

      // Snap tail to the next newline boundary to avoid mid-line cuts
      const rawTail = body.slice(-preserveChars);
      const firstNewline = rawTail.indexOf('\n');
      const tail = firstNewline >= 0 ? rawTail.slice(firstNewline + 1) : rawTail;

      const remainingBudget = maxChars - header.length - tail.length - 50; // 50 for separator

      if (remainingBudget > 0) {
        const head = body.slice(0, remainingBudget);
        result = header + head + '\n\n[... earlier messages truncated ...]\n\n' + tail;
      } else {
        result = header + '[... messages truncated ...]\n\n' + tail;
      }
    }

    return result;
  }
}
