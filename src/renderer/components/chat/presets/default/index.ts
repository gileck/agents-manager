/**
 * Default chat preset — assembles the preset object and registers it.
 *
 * Import this module to ensure the default preset is available in the registry.
 */

import type { ChatPreset } from '../ChatPreset';
import { registerPreset } from '../registry';
import { DefaultChatPanel } from './DefaultChatPanel';

export { DefaultChatPanel } from './DefaultChatPanel';
export { DefaultChatMessageList } from './DefaultChatMessageList';
export { DefaultChatInput } from './DefaultChatInput';
export { DefaultAgentBlock } from './DefaultAgentBlock';
export { DefaultSessionTabs } from './DefaultSessionTabs';

const defaultPreset: ChatPreset = {
  name: 'default',
  label: 'Default',
  ChatPanel: DefaultChatPanel,
};

registerPreset(defaultPreset);

export default defaultPreset;
