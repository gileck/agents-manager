/**
 * ChatPreset interface — defines the contract for a visual chat preset.
 *
 * Each preset provides a set of React component implementations for the chat UI.
 * The prop types for each slot are defined in `./types.ts`.
 */

import type React from 'react';
import type { ChatPanelPresetProps } from './types';

/** A chat preset is a named collection of component slots for the chat UI. */
export interface ChatPreset {
  /** Unique machine-readable name (e.g. "default", "minimal"). */
  name: string;
  /** Human-readable label shown in the preset selector. */
  label: string;
  /** Top-level chat panel component. */
  ChatPanel: React.ComponentType<ChatPanelPresetProps>;
}
