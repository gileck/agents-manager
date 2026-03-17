/**
 * Claude Code chat preset — assembles the preset object and registers it.
 *
 * Import this module to ensure the Claude Code preset is available in the registry.
 */

import type { ChatPreset } from '../ChatPreset';
import { registerPreset } from '../registry';
import { ClaudeCodeChatPanel } from './ClaudeCodeChatPanel';
import { ClaudeCodeChatMessageList } from './ClaudeCodeChatMessageList';
import { ClaudeCodeChatInput } from './ClaudeCodeChatInput';
import { ClaudeCodeAgentBlock } from './ClaudeCodeAgentBlock';
import { ClaudeCodeSessionTabs } from './ClaudeCodeSessionTabs';

export { ClaudeCodeChatPanel } from './ClaudeCodeChatPanel';
export { ClaudeCodeChatMessageList } from './ClaudeCodeChatMessageList';
export { ClaudeCodeChatInput } from './ClaudeCodeChatInput';
export { ClaudeCodeAgentBlock } from './ClaudeCodeAgentBlock';
export { ClaudeCodeSessionTabs } from './ClaudeCodeSessionTabs';

const claudeCodePreset: ChatPreset = {
  name: 'claude-code',
  label: 'Claude Code',
  ChatPanel: ClaudeCodeChatPanel,
  ChatMessageList: ClaudeCodeChatMessageList,
  ChatInput: ClaudeCodeChatInput,
  AgentBlock: ClaudeCodeAgentBlock,
  SessionTabs: ClaudeCodeSessionTabs,
};

registerPreset(claudeCodePreset);

export default claudeCodePreset;
