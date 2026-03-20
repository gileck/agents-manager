import React, { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTabsContext, ICON_MAP } from '../../contexts/TabsContext';
import { formatCombo } from '../../lib/keyboardShortcuts';
import { useKeyboardShortcutsConfig } from '../../hooks/useKeyboardShortcutsConfig';

export function TabBar() {
  const { state, config, switchTab, closeTab, getCloseTabTarget } = useTabsContext();
  const navigate = useNavigate();
  const { getCombo } = useKeyboardShortcutsConfig();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Scroll active tab into view when it changes
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [state.activeTabId]);

  if (!config.enabled || state.tabs.length === 0) {
    return null;
  }

  const handleNavigateToTab = (tabId: string) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) {
      switchTab(tabId);
      navigate(tab.path);
    }
  };

  const handleCloseTab = (tabId: string) => {
    const target = getCloseTabTarget(tabId);
    closeTab(tabId);
    if (target) {
      navigate(target);
    }
  };

  return (
    <div className="flex items-center border-b border-border bg-muted/30 h-9 shrink-0 overflow-hidden">
      <div
        ref={scrollRef}
        className="flex items-stretch flex-1 overflow-x-auto scrollbar-none"
      >
        {state.tabs.map((tab, idx) => {
          const isActive = tab.id === state.activeTabId;
          const Icon = ICON_MAP[tab.iconName];

          return (
            <button
              key={tab.id}
              ref={isActive ? activeTabRef : undefined}
              onClick={() => handleNavigateToTab(tab.id)}
              title={`${tab.label}${idx < 9 ? ` (${formatCombo(`CmdOrCtrl+${idx + 1}`)})` : ''}`}
              className={cn(
                'group flex items-center gap-1.5 px-3 h-full text-xs font-medium border-r border-border whitespace-nowrap transition-colors min-w-0 max-w-[180px] relative',
                isActive
                  ? 'bg-background text-foreground border-b border-b-background -mb-px'
                  : 'text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground'
              )}
            >
              {/* Active indicator — top bar */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary" />
              )}

              {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{tab.label}</span>

              {/* Close button */}
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }
                }}
                title={`Close (${formatCombo(getCombo('tabs.closeTab'))})`}
                className={cn(
                  'ml-1 rounded-sm p-0.5 shrink-0 transition-colors',
                  'opacity-0 group-hover:opacity-100',
                  isActive && 'opacity-60',
                  'hover:bg-muted-foreground/20'
                )}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
