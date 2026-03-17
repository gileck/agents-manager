/**
 * Default preset — AgentBlock wrapper.
 *
 * Re-exports the existing AgentBlock for use in the preset system.
 */

import React from 'react';
import type { AgentBlockPresetProps } from '../types';
import { AgentBlock } from '../../AgentBlock';

export function DefaultAgentBlock(props: AgentBlockPresetProps) {
  return <AgentBlock {...props} />;
}
