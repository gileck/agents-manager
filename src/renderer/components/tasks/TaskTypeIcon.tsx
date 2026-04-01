import React from 'react';
import { Bug, Sparkles, Wrench } from 'lucide-react';
import type { TaskType } from '../../../shared/types';

interface TaskTypeIconProps {
  type: TaskType | undefined | null;
  className?: string;
  size?: number;
  showLabel?: boolean;
}

const TYPE_CONFIG: Record<TaskType, { icon: React.ElementType; color: string; label: string }> = {
  bug: { icon: Bug, color: 'text-red-500', label: 'Bug' },
  feature: { icon: Sparkles, color: 'text-emerald-500', label: 'Feature' },
  improvement: { icon: Wrench, color: 'text-blue-500', label: 'Improvement' },
};

export function TaskTypeIcon({ type, className = '', size = 14, showLabel = false }: TaskTypeIconProps) {
  if (!type) return null;
  const config = TYPE_CONFIG[type];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 shrink-0 ${config.color} ${className}`} title={config.label}>
      <Icon size={size} />
      {showLabel && <span className="text-xs">{config.label}</span>}
    </span>
  );
}
