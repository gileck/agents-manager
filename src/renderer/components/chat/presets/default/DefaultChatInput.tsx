/**
 * Default preset — ChatInput wrapper.
 *
 * Re-exports the existing ChatInput for use in the preset system.
 */

import React from 'react';
import type { ChatInputPresetProps } from '../types';
import { ChatInput } from '../../ChatInput';

export function DefaultChatInput(props: ChatInputPresetProps) {
  return <ChatInput {...props} />;
}
