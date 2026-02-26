import { describe, it, expect } from 'vitest';
import { messagesToRawText } from '../../src/shared/agent-message-utils';
import type { AgentChatMessage } from '../../src/shared/types';

const ts = Date.now();

describe('agent-message-utils', () => {
  describe('messagesToRawText', () => {
    it('returns empty string for empty array', () => {
      expect(messagesToRawText([])).toBe('');
    });

    it('converts assistant_text messages', () => {
      const messages: AgentChatMessage[] = [
        { type: 'assistant_text', text: 'Hello world', timestamp: ts },
      ];
      expect(messagesToRawText(messages)).toBe('Hello world\n');
    });

    it('converts tool_use messages', () => {
      const messages: AgentChatMessage[] = [
        { type: 'tool_use', toolName: 'read_file', input: '/path/to/file', timestamp: ts },
      ];
      expect(messagesToRawText(messages)).toBe('\n> Tool: read_file\n> Input: /path/to/file\n');
    });

    it('converts tool_result messages', () => {
      const messages: AgentChatMessage[] = [
        { type: 'tool_result', result: 'file contents here', timestamp: ts },
      ];
      expect(messagesToRawText(messages)).toBe('[tool] file contents here\n');
    });

    it('skips user messages', () => {
      const messages: AgentChatMessage[] = [
        { type: 'user', text: 'What is this?', timestamp: ts },
      ];
      expect(messagesToRawText(messages)).toBe('');
    });

    it('skips status messages', () => {
      const messages: AgentChatMessage[] = [
        { type: 'status', status: 'running', message: 'Agent started', timestamp: ts },
      ];
      expect(messagesToRawText(messages)).toBe('');
    });

    it('skips usage messages', () => {
      const messages: AgentChatMessage[] = [
        { type: 'usage', inputTokens: 100, outputTokens: 200, timestamp: ts },
      ];
      expect(messagesToRawText(messages)).toBe('');
    });

    it('concatenates multiple message types in order', () => {
      const messages: AgentChatMessage[] = [
        { type: 'assistant_text', text: 'I will read the file', timestamp: ts },
        { type: 'tool_use', toolName: 'read_file', input: 'src/index.ts', timestamp: ts + 1 },
        { type: 'tool_result', result: 'export default {};', timestamp: ts + 2 },
        { type: 'assistant_text', text: 'The file exports an empty object', timestamp: ts + 3 },
        { type: 'usage', inputTokens: 500, outputTokens: 100, timestamp: ts + 4 },
      ];
      const result = messagesToRawText(messages);
      expect(result).toBe(
        'I will read the file\n' +
        '\n> Tool: read_file\n> Input: src/index.ts\n' +
        '[tool] export default {};\n' +
        'The file exports an empty object\n',
      );
    });

    it('handles tool_use with toolId', () => {
      const messages: AgentChatMessage[] = [
        { type: 'tool_use', toolName: 'bash', toolId: 'tool_123', input: 'ls -la', timestamp: ts },
      ];
      // toolId is present but not included in raw text output
      expect(messagesToRawText(messages)).toBe('\n> Tool: bash\n> Input: ls -la\n');
    });
  });
});
