/**
 * Codex chat preset — assembles the preset object and registers it.
 *
 * Import this module to ensure the Codex preset is available in the registry.
 */

import type { ChatPreset } from '../ChatPreset';
import { registerPreset } from '../registry';
import { CodexChatPanel } from './CodexChatPanel';
import { CodexChatMessageList } from './CodexChatMessageList';
import { CodexChatInput } from './CodexChatInput';
import { CodexAgentBlock } from './CodexAgentBlock';
import { CodexSessionTabs } from './CodexSessionTabs';

export { CodexChatPanel } from './CodexChatPanel';
export { CodexChatMessageList } from './CodexChatMessageList';
export { CodexChatInput } from './CodexChatInput';
export { CodexAgentBlock } from './CodexAgentBlock';
export { CodexSessionTabs } from './CodexSessionTabs';

const codexPreset: ChatPreset = {
  name: 'codex',
  label: 'Codex',
  ChatPanel: CodexChatPanel,
  ChatMessageList: CodexChatMessageList,
  ChatInput: CodexChatInput,
  AgentBlock: CodexAgentBlock,
  SessionTabs: CodexSessionTabs,
};

registerPreset(codexPreset);

export default codexPreset;
