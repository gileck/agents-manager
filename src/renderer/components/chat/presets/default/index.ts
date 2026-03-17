/**
 * Default chat preset — assembles the preset object and registers it.
 *
 * Import this module to ensure the default preset is available in the registry.
 */

import type { ChatPreset } from '../ChatPreset';
import { registerPreset } from '../registry';
import { DefaultChatPanel } from './DefaultChatPanel';
import { DefaultChatMessageList } from './DefaultChatMessageList';
import { DefaultChatInput } from './DefaultChatInput';
import { DefaultAgentBlock } from './DefaultAgentBlock';
import { DefaultSessionTabs } from './DefaultSessionTabs';

export { DefaultChatPanel } from './DefaultChatPanel';
export { DefaultChatMessageList } from './DefaultChatMessageList';
export { DefaultChatInput } from './DefaultChatInput';
export { DefaultAgentBlock } from './DefaultAgentBlock';
export { DefaultSessionTabs } from './DefaultSessionTabs';

const defaultPreset: ChatPreset = {
  name: 'default',
  label: 'Default',
  ChatPanel: DefaultChatPanel,
  ChatMessageList: DefaultChatMessageList,
  ChatInput: DefaultChatInput,
  AgentBlock: DefaultAgentBlock,
  SessionTabs: DefaultSessionTabs,
};

registerPreset(defaultPreset);

export default defaultPreset;
