import type { AgentChatMessage } from '../../../shared/types';

/**
 * Parse raw agent output text into structured AgentChatMessage[] for the rendered view.
 *
 * Raw format (from base-claude-agent.ts):
 *   Assistant text:  <text>\n
 *   Tool use:        \n> Tool: <name>\n> Input: <json>\n
 *   Tool result:     [tool] <result>\n
 */
export function parseRawOutput(raw: string): AgentChatMessage[] {
  if (!raw) return [];

  const messages: AgentChatMessage[] = [];
  const lines = raw.split('\n');
  const now = Date.now();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Tool use: "> Tool: NAME" followed by "> Input: JSON"
    if (line.startsWith('> Tool: ')) {
      const toolName = line.slice('> Tool: '.length);
      let input = '';
      if (i + 1 < lines.length && lines[i + 1].startsWith('> Input: ')) {
        input = lines[i + 1].slice('> Input: '.length);
        i += 2;
      } else {
        i++;
      }
      messages.push({ type: 'tool_use', toolName, input, timestamp: now });
      continue;
    }

    // Tool result: "[tool] RESULT" (possibly multiline until next marker)
    if (line.startsWith('[tool] ')) {
      const resultLines = [line.slice('[tool] '.length)];
      i++;
      while (i < lines.length && !isMarker(lines[i])) {
        resultLines.push(lines[i]);
        i++;
      }
      messages.push({ type: 'tool_result', result: resultLines.join('\n').trimEnd(), timestamp: now });
      continue;
    }

    // Assistant text: collect until next marker
    const textLines: string[] = [];
    while (i < lines.length && !isMarker(lines[i])) {
      textLines.push(lines[i]);
      i++;
    }
    const text = textLines.join('\n').trim();
    if (text) {
      messages.push({ type: 'assistant_text', text, timestamp: now });
    }
  }

  return messages;
}

function isMarker(line: string): boolean {
  return line.startsWith('> Tool: ') || line.startsWith('[tool] ');
}
