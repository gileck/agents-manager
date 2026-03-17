/**
 * Default preset — ChatPanel wrapper.
 *
 * Delegates directly to the existing ChatPanel component,
 * ensuring pixel-identical rendering with the pre-preset UI.
 */

import React from 'react';
import type { ChatPanelPresetProps } from '../types';
import { ChatPanel } from '../../ChatPanel';

export function DefaultChatPanel(props: ChatPanelPresetProps) {
  return <ChatPanel {...props} />;
}
