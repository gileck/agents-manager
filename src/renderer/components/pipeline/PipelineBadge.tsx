import React from 'react';
import { Badge, type BadgeProps } from '../ui/badge';
import type { Pipeline } from '../../../shared/types';

interface PipelineBadgeProps {
  status: string;
  pipeline?: Pipeline | null;
}

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const NAMED_COLOR_TO_VARIANT: Record<string, BadgeVariant> = {
  blue: 'default',
  gray: 'secondary',
  red: 'destructive',
  green: 'success',
  yellow: 'warning',
  orange: 'warning',
};

function hexToVariant(hex: string): BadgeVariant {
  // Parse hex to RGB and pick the closest Badge variant by hue
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  // Low saturation → secondary (gray)
  if (max - min < 40) return 'secondary';

  if (r > g && r > b) return 'destructive'; // red-ish
  if (g > r && g > b) return 'success';     // green-ish
  if (b > r && b > g) return 'default';     // blue-ish
  if (r > b) return 'warning';              // yellow/orange-ish

  return 'outline';
}

function colorToVariant(color: string): BadgeVariant {
  if (color.startsWith('#')) return hexToVariant(color);
  return NAMED_COLOR_TO_VARIANT[color] ?? 'outline';
}

// Fallback colors for common status names when pipeline doesn't define a color
const STATUS_NAME_FALLBACK: Record<string, BadgeVariant> = {
  open: 'default',
  done: 'success',
  closed: 'secondary',
  planning: 'warning',
  implementing: 'default',
  in_progress: 'default',
  pr_review: 'warning',
  pr_ready: 'warning',
  failed: 'destructive',
  blocked: 'destructive',
};

function statusNameToVariant(name: string): BadgeVariant {
  return STATUS_NAME_FALLBACK[name.toLowerCase()] ?? 'outline';
}

export function PipelineBadge({ status, pipeline }: PipelineBadgeProps) {
  if (!pipeline) {
    return <Badge variant={statusNameToVariant(status)}>{status}</Badge>;
  }

  const statusDef = pipeline.statuses.find((s) => s.name === status);
  if (!statusDef) {
    return <Badge variant={statusNameToVariant(status)}>{status}</Badge>;
  }

  const variant = statusDef.color
    ? colorToVariant(statusDef.color)
    : statusNameToVariant(status);

  return <Badge variant={variant}>{statusDef.label || status}</Badge>;
}
