import React from 'react';
import { Lightbulb, Bug, Sparkles, AlertTriangle } from 'lucide-react';
import { THREAD_INTENTS, type ThreadIntent } from '../../lib/thread-intent-prompts';
import { cn } from '../../lib/utils';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Lightbulb,
  Bug,
  Sparkles,
  AlertTriangle,
};

interface ThreadIntentIconProps {
  intent: string | null;
  className?: string;
}

/**
 * Renders the colored Lucide icon for a thread intent.
 * Returns null if the intent is null or unrecognised.
 */
export function ThreadIntentIcon({ intent, className }: ThreadIntentIconProps) {
  if (!intent) return null;
  const config = THREAD_INTENTS[intent as ThreadIntent];
  if (!config) return null;
  const Icon = ICON_MAP[config.icon];
  if (!Icon) return null;
  return <Icon className={cn(config.colorClass, className)} />;
}
