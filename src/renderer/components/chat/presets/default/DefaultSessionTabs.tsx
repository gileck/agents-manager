/**
 * Default preset — SessionTabs wrapper.
 *
 * Re-exports the existing SessionTabs for use in the preset system.
 */

import React from 'react';
import type { SessionTabsPresetProps } from '../types';
import { SessionTabs } from '../../SessionTabs';

export function DefaultSessionTabs(props: SessionTabsPresetProps) {
  return <SessionTabs {...props} />;
}
