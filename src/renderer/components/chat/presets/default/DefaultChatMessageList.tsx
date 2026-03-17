/**
 * Default preset — ChatMessageList wrapper.
 *
 * Re-exports the existing ChatMessageList for use in the preset system.
 */

import React from 'react';
import type { ChatMessageListPresetProps } from '../types';
import { ChatMessageList } from '../../ChatMessageList';

export function DefaultChatMessageList(props: ChatMessageListPresetProps) {
  return <ChatMessageList {...props} />;
}
