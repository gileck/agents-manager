import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, FolderPlus, Search } from 'lucide-react';
import { cn, fuzzyMatch } from '../../lib/utils';
import { useProjects } from '../../hooks/useProjects';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useKeyboardShortcutsConfig } from '../../hooks/useKeyboardShortcutsConfig';
import { formatCombo } from '../../lib/keyboardShortcuts';
import { reportError } from '../../lib/error-handler';

interface PickerItem {
  id: string;
  type: 'project' | 'add';
  name: string;
  path?: string;
  isCurrent?: boolean;
}

export function ProjectPickerDialog() {
  const { projects, refetch } = useProjects();
  const { currentProjectId } = useCurrentProject();
  const { getCombo } = useKeyboardShortcutsConfig();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* ── Listen for open event ── */
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-project-picker', handler);
    return () => window.removeEventListener('open-project-picker', handler);
  }, []);

  /* ── Reset state when opening ── */
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      refetch();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, refetch]);

  /* ── Build filtered items ── */
  const items = useMemo((): PickerItem[] => {
    const result: PickerItem[] = [];

    const filtered = query.trim()
      ? projects.filter(p => fuzzyMatch(query, p.name) || (p.path && fuzzyMatch(query, p.path)))
      : projects;

    for (const project of filtered) {
      result.push({
        id: project.id,
        type: 'project',
        name: project.name,
        path: project.path ?? undefined,
        isCurrent: project.id === currentProjectId,
      });
    }

    // Always show "Add project" at the end
    result.push({
      id: '__add__',
      type: 'add',
      name: 'Open folder as project...',
    });

    return result;
  }, [projects, query, currentProjectId]);

  /* ── Scroll selected into view ── */
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  /* ── Select action ── */
  const selectItem = useCallback(async (item: PickerItem) => {
    setOpen(false);
    if (item.type === 'add') {
      try {
        const folderPath = await window.api.dialog.pickFolder();
        if (!folderPath) return;
        const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
        const project = await window.api.projects.create({ name: folderName, path: folderPath });
        await window.api.window.openProject(project.id);
      } catch (err) {
        reportError(err, 'Add project');
      }
    } else if (item.isCurrent) {
      // Already on this project — do nothing
    } else {
      try {
        await window.api.window.openProject(item.id);
      } catch (err) {
        reportError(err, 'Open project in new window');
      }
    }
  }, []);

  /* ── Keyboard handler ── */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) selectItem(item);
      return;
    }
  };

  if (!open) return null;

  const shortcutLabel = formatCombo(getCombo('global.projectPicker'));
  const portalTarget = document.getElementById('app-root') || document.body;

  return createPortal(
    <div
      className="absolute inset-0 z-50 flex items-start justify-center pt-[18vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-lg bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl ring-1 ring-white/10 overflow-hidden animate-in fade-in-0 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
          <Search className="h-5 w-5 text-muted-foreground/70 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search projects..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground/60 outline-none"
          />
          <span className="text-[10px] text-muted-foreground/50 bg-muted/30 px-1.5 py-0.5 rounded shrink-0">
            {shortcutLabel}
          </span>
        </div>

        {/* Results */}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <FolderOpen className="h-8 w-8 text-muted-foreground/30" />
            <span className="text-sm text-muted-foreground/60">No projects found</span>
          </div>
        ) : (
          <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
            {items.map((item, idx) => (
              <button
                key={item.id}
                data-index={idx}
                onClick={() => selectItem(item)}
                className={cn(
                  'flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors duration-75',
                  idx === selectedIndex
                    ? 'bg-accent/80 text-accent-foreground rounded-lg'
                    : 'text-foreground hover:bg-muted/40',
                )}
              >
                {item.type === 'add' ? (
                  <FolderPlus className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                ) : (
                  <FolderOpen className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-medium truncate">
                    {item.name}
                    {item.isCurrent && (
                      <span className="ml-2 text-[10px] text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded-full">
                        current
                      </span>
                    )}
                  </span>
                  {item.path && (
                    <span className="text-[11px] text-muted-foreground/50 truncate">
                      {item.path}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-border/30 text-[10px] text-muted-foreground/50 flex items-center gap-4">
          <span>↑↓ navigate</span>
          <span>↵ open in new window</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
