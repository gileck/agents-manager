/**
 * PresetChatPanel — renders the active preset's ChatPanel component.
 *
 * Drop this in place of `<ChatPanel>` to get preset-aware rendering.
 * Must be used inside a `<ChatPresetProvider>`.
 */

import React from 'react';
import type { ChatPanelPresetProps } from './types';
import { usePreset } from './ChatPresetContext';

export function PresetChatPanel(props: ChatPanelPresetProps) {
  const { preset } = usePreset();
  const Panel = preset.ChatPanel;
  return <Panel {...props} />;
}
