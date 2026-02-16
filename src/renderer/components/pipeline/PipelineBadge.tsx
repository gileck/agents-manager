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

export function PipelineBadge({ status, pipeline }: PipelineBadgeProps) {
  if (!pipeline) {
    return <Badge variant="outline">{status}</Badge>;
  }

  const statusDef = pipeline.statuses.find((s) => s.name === status);
  if (!statusDef) {
    return <Badge variant="outline">{status}</Badge>;
  }

  const variant = statusDef.color ? colorToVariant(statusDef.color) : 'outline';

  return <Badge variant={variant}>{statusDef.label || status}</Badge>;
}
