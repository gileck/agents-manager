export type ShortcutContext = 'chat' | 'kanban';

export interface ShortcutDefinition {
  id: string;
  context: ShortcutContext;
  description: string;
  defaultCombo: string;
  notCustomizable?: boolean;
}

export const SHORTCUT_REGISTRY: ShortcutDefinition[] = [
  // Chat shortcuts
  { id: 'chat.newSession',      context: 'chat',   description: 'New chat session',            defaultCombo: 'CmdOrCtrl+n' },
  { id: 'chat.closeSession',    context: 'chat',   description: 'Close current session',        defaultCombo: 'CmdOrCtrl+w' },
  { id: 'chat.prevSession',     context: 'chat',   description: 'Previous session',             defaultCombo: 'CmdOrCtrl+[' },
  { id: 'chat.nextSession',     context: 'chat',   description: 'Next session',                 defaultCombo: 'CmdOrCtrl+]' },
  { id: 'chat.focusInput',      context: 'chat',   description: 'Focus chat input',             defaultCombo: 'CmdOrCtrl+l' },
  { id: 'chat.clearChat',       context: 'chat',   description: 'Clear conversation',           defaultCombo: 'CmdOrCtrl+k' },
  { id: 'chat.jumpToSession',   context: 'chat',   description: 'Jump to session by index (1–9)', defaultCombo: 'CmdOrCtrl+1–9', notCustomizable: true },
  // Kanban shortcuts
  { id: 'kanban.navLeft',       context: 'kanban', description: 'Navigate to previous column',  defaultCombo: 'ArrowLeft' },
  { id: 'kanban.navRight',      context: 'kanban', description: 'Navigate to next column',      defaultCombo: 'ArrowRight' },
  { id: 'kanban.navUp',         context: 'kanban', description: 'Navigate to card above',       defaultCombo: 'ArrowUp' },
  { id: 'kanban.navDown',       context: 'kanban', description: 'Navigate to card below',       defaultCombo: 'ArrowDown' },
  { id: 'kanban.openCard',      context: 'kanban', description: 'Open selected card',           defaultCombo: 'Enter' },
  { id: 'kanban.newTask',       context: 'kanban', description: 'Create new task',              defaultCombo: 'n' },
  { id: 'kanban.clearSelection',context: 'kanban', description: 'Clear selection',              defaultCombo: 'Escape', notCustomizable: true },
];

/**
 * Normalize a combo string so storage is always consistent.
 * The key portion is lowercased; modifiers are kept as-is.
 * e.g. "CmdOrCtrl+N" -> "CmdOrCtrl+n"
 */
export function normalizeCombo(combo: string): string {
  const parts = combo.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  const modifiers = parts.slice(0, -1);
  return [...modifiers, key].join('+');
}

/**
 * Check whether a KeyboardEvent matches a given combo string.
 * Combo format: optional "CmdOrCtrl+" prefix, then the key (lowercase).
 */
export function matchesKeyEvent(combo: string, event: KeyboardEvent): boolean {
  const normalized = normalizeCombo(combo);
  const parts = normalized.split('+');
  const key = parts[parts.length - 1];
  const needsCmdOrCtrl = parts.includes('CmdOrCtrl');

  const eventKey = event.key.toLowerCase();
  const hasCmdOrCtrl = event.metaKey || event.ctrlKey;

  if (needsCmdOrCtrl !== hasCmdOrCtrl) return false;
  return eventKey === key;
}

/**
 * Build a combo string from a live KeyboardEvent (used during recording).
 * Returns null for pure modifier keypresses.
 */
export function comboFromKeyEvent(event: KeyboardEvent): string | null {
  const modifierKeys = ['meta', 'control', 'alt', 'shift', 'os', 'control'];
  const key = event.key.toLowerCase();
  if (modifierKeys.includes(key)) return null;

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('CmdOrCtrl');
  parts.push(key);
  return parts.join('+');
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');

/**
 * Return a human-readable label for a combo string.
 * e.g. "CmdOrCtrl+n" -> "⌘N" on Mac, "Ctrl+N" on Windows
 */
export function formatCombo(combo: string): string {
  if (combo === 'CmdOrCtrl+1–9') return isMac ? '⌘1–9' : 'Ctrl+1–9';
  const normalized = normalizeCombo(combo);
  const parts = normalized.split('+');
  const key = parts[parts.length - 1];
  const hasCmdOrCtrl = parts.includes('CmdOrCtrl');

  const keyLabel = key.length === 1 ? key.toUpperCase() : key;

  if (hasCmdOrCtrl) {
    return isMac ? `⌘${keyLabel}` : `Ctrl+${keyLabel}`;
  }
  return keyLabel;
}
