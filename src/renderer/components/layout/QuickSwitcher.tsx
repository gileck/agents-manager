import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { cn, fuzzyMatch } from '../../lib/utils';
import { useTabsContext, ICON_MAP, getRecentPages } from '../../contexts/TabsContext';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';

interface SwitcherItem {
  key: string;
  label: string;
  path: string;
  iconName: string;
  isOpenTab: boolean;
  tabId?: string;
}

export function QuickSwitcher() {
  const { state, config, quickSwitcherOpen, setQuickSwitcherOpen, switchTab } = useTabsContext();
  const { currentProjectId } = useCurrentProject();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build the list of items: open tabs first, then recent pages not already open
  const allItems = useMemo((): SwitcherItem[] => {
    const items: SwitcherItem[] = [];

    // Open tabs
    for (const tab of state.tabs) {
      items.push({
        key: `tab:${tab.id}`,
        label: tab.label,
        path: tab.path,
        iconName: tab.iconName,
        isOpenTab: true,
        tabId: tab.id,
      });
    }

    // Recent pages not in open tabs
    const openPaths = new Set(state.tabs.map(t => t.path));
    const recentPages = getRecentPages(currentProjectId);
    for (const page of recentPages) {
      if (!openPaths.has(page.path)) {
        items.push({
          key: `recent:${page.path}`,
          label: page.label,
          path: page.path,
          iconName: page.iconName,
          isOpenTab: false,
        });
      }
    }

    return items;
  }, [state.tabs, currentProjectId]);

  const filtered = useMemo(() => {
    if (!query) return allItems;
    return allItems.filter(item =>
      fuzzyMatch(item.label, query) || fuzzyMatch(item.path, query)
    );
  }, [allItems, query]);

  // Reset state when opening
  useEffect(() => {
    if (quickSwitcherOpen) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [quickSwitcherOpen]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const selectItem = (item: SwitcherItem) => {
    setQuickSwitcherOpen(false);
    if (item.isOpenTab && item.tabId) {
      switchTab(item.tabId);
      navigate(item.path);
    } else {
      navigate(item.path);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setQuickSwitcherOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIndex];
      if (item) selectItem(item);
      return;
    }
  };

  if (!quickSwitcherOpen || !config.enabled) return null;

  const portalTarget = document.getElementById('app-root') || document.body;

  return createPortal(
    <div
      className="absolute inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setQuickSwitcherOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Modal */}
      <div
        className="relative w-full max-w-md bg-popover border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search open tabs and recent pages..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching pages
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = ICON_MAP[item.iconName];
              return (
                <button
                  key={item.key}
                  onClick={() => selectItem(item)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors',
                    idx === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-muted/50'
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="flex-1 truncate">{item.label}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[150px]">{item.path}</span>
                  {item.isOpenTab && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">open</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground flex gap-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
