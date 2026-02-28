/**
 * Color system for the Kanban board.
 *
 * IMPORTANT: Tailwind background colors with opacity modifiers (e.g. bg-blue-500/20)
 * do NOT render in Electron. All colors that require opacity are provided as
 * inline style objects using rgba() values instead.
 */

import type { CSSProperties } from 'react';

export interface ColumnColorTheme {
  /** Tailwind class for the column card left border accent (no opacity modifier) */
  accent: string;
  /** Hex color for the accent dot */
  accentColor: string;
  /** Inline style for the column header gradient background */
  headerStyle: CSSProperties;
  /** Inline style for the count badge */
  badgeStyle: CSSProperties;
  /** Inline style for the drop zone highlight (applied to the column container) */
  dropZoneStyle: CSSProperties;
  /** Inline style for empty state icon color */
  emptyIconStyle: CSSProperties;
}

function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ColorDef {
  hex: string;
  /** Tailwind border class without opacity (e.g. border-l-blue-500) */
  borderClass: string;
}

const COLORS: ColorDef[] = [
  { hex: '#3b82f6', borderClass: 'border-l-blue-500' },     // Blue
  { hex: '#8b5cf6', borderClass: 'border-l-violet-500' },   // Violet
  { hex: '#f59e0b', borderClass: 'border-l-amber-500' },    // Amber
  { hex: '#14b8a6', borderClass: 'border-l-teal-500' },     // Teal
  { hex: '#f43f5e', borderClass: 'border-l-rose-500' },     // Rose
  { hex: '#10b981', borderClass: 'border-l-emerald-500' },  // Emerald
  { hex: '#f97316', borderClass: 'border-l-orange-500' },   // Orange
  { hex: '#06b6d4', borderClass: 'border-l-cyan-500' },     // Cyan
  { hex: '#ec4899', borderClass: 'border-l-pink-500' },     // Pink
  { hex: '#6366f1', borderClass: 'border-l-indigo-500' },   // Indigo
];

function buildColumnTheme(color: ColorDef): ColumnColorTheme {
  const { hex } = color;
  return {
    accent: color.borderClass,
    accentColor: hex,
    headerStyle: {
      background: `linear-gradient(to right, ${rgba(hex, 0.15)}, ${rgba(hex, 0.05)})`,
    },
    badgeStyle: {
      backgroundColor: rgba(hex, 0.2),
      color: hex,
    },
    dropZoneStyle: {
      boxShadow: `0 0 0 2px ${rgba(hex, 0.5)}`,
      backgroundColor: rgba(hex, 0.05),
    },
    emptyIconStyle: {
      color: rgba(hex, 0.4),
    },
  };
}

const COLUMN_THEMES: ColumnColorTheme[] = COLORS.map(buildColumnTheme);

/** Get a color theme for a column by its index */
export function getColumnColor(index: number): ColumnColorTheme {
  return COLUMN_THEMES[index % COLUMN_THEMES.length];
}

/** Tag color style - uses inline styles for Electron compatibility */
export interface TagColorStyle {
  style: CSSProperties;
}

interface TagColorDef {
  hex: string;
}

const TAG_COLORS: Record<string, TagColorDef> = {
  bug: { hex: '#ef4444' },
  ui: { hex: '#a855f7' },
  chat: { hex: '#0ea5e9' },
  'workflow-review': { hex: '#f59e0b' },
  feature: { hex: '#10b981' },
  enhancement: { hex: '#3b82f6' },
  fix: { hex: '#f97316' },
  docs: { hex: '#14b8a6' },
  test: { hex: '#06b6d4' },
  refactor: { hex: '#6366f1' },
};

const FALLBACK_TAG_HEXES = ['#d946ef', '#84cc16', '#8b5cf6', '#f43f5e', '#0ea5e9'];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function buildTagStyle(hex: string): TagColorStyle {
  return {
    style: {
      backgroundColor: rgba(hex, 0.15),
      color: hex,
      borderColor: rgba(hex, 0.3),
    },
  };
}

/** Get inline styles for a tag */
export function getTagColor(tag: string): TagColorStyle {
  const lower = tag.toLowerCase();
  const def = TAG_COLORS[lower];
  if (def) {
    return buildTagStyle(def.hex);
  }
  const fallbackHex = FALLBACK_TAG_HEXES[hashString(lower) % FALLBACK_TAG_HEXES.length];
  return buildTagStyle(fallbackHex);
}
