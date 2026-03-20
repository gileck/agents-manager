import React, { useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTabsContext, ICON_MAP, type PageTab } from '../../contexts/TabsContext';
import { useActiveAgents } from '../../hooks/useActiveAgents';
import { formatCombo } from '../../lib/keyboardShortcuts';
import { useKeyboardShortcutsConfig } from '../../hooks/useKeyboardShortcutsConfig';
import { reportError } from '../../lib/error-handler';

const MAX_LABEL_LENGTH = 24;

/** Extract the entity ID from a tab identity string (e.g., "task:abc123" → "abc123") */
function getEntityId(identity: string): string | null {
  const idx = identity.indexOf(':');
  return idx >= 0 ? identity.slice(idx + 1) : null;
}

/** Truncate label to max length */
function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label;
  return label.slice(0, MAX_LABEL_LENGTH - 1) + '…';
}

/** Check if a tab label is still the default (ID-based) and needs fetching */
function isDefaultLabel(tab: PageTab): boolean {
  if (tab.identity.startsWith('task:')) {
    const id = getEntityId(tab.identity);
    return tab.label === `Task ${id?.slice(0, 8)}`;
  }
  if (tab.identity.startsWith('project:')) {
    return tab.label === 'Project';
  }
  return false;
}

export function TabBar() {
  const { state, config, switchTab, closeTab, getCloseTabTarget, updateTabLabel } = useTabsContext();
  const { agents } = useActiveAgents();
  const navigate = useNavigate();
  const { getCombo } = useKeyboardShortcutsConfig();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  // Track in-flight fetches to prevent concurrent duplicate requests
  const fetchingRef = useRef<Set<string>>(new Set());

  // Scroll active tab into view when it changes
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [state.activeTabId]);

  // Fetch real title for a tab and update it in context (persisted to localStorage)
  const fetchTitle = useCallback(async (tab: PageTab) => {
    const entityId = getEntityId(tab.identity);
    if (!entityId || fetchingRef.current.has(tab.identity)) return;
    fetchingRef.current.add(tab.identity);

    try {
      if (tab.identity.startsWith('task:')) {
        const task = await window.api.tasks.get(entityId);
        if (task?.title) {
          updateTabLabel(tab.id, truncateLabel(task.title));
        }
      } else if (tab.identity.startsWith('project:')) {
        const project = await window.api.projects.get(entityId);
        if (project?.name) {
          updateTabLabel(tab.id, truncateLabel(project.name));
        }
      }
    } catch (err) {
      reportError(err, 'TabBar: fetch entity title');
    } finally {
      fetchingRef.current.delete(tab.identity);
    }
  }, [updateTabLabel]);

  // Fetch titles for tabs that still have default labels
  useEffect(() => {
    for (const tab of state.tabs) {
      if (isDefaultLabel(tab)) {
        fetchTitle(tab);
      }
    }
  }, [state.tabs, fetchTitle]);

  if (!config.enabled || state.tabs.length === 0) {
    return null;
  }

  // Build a set of entity IDs that have a running agent
  const runningTaskIds = new Set<string>();
  for (const agent of agents) {
    if (agent.status === 'running' && agent.scopeType === 'task') {
      runningTaskIds.add(agent.scopeId);
    }
  }

  const isTabRunning = (tab: PageTab): boolean => {
    if (tab.identity.startsWith('task:')) {
      const taskId = getEntityId(tab.identity);
      return taskId ? runningTaskIds.has(taskId) : false;
    }
    if (tab.identity === 'page:/chat') {
      return agents.some(a => a.status === 'running' && a.scopeType === 'project');
    }
    return false;
  };

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
          const running = isTabRunning(tab);

          return (
            <button
              key={tab.id}
              ref={isActive ? activeTabRef : undefined}
              onClick={() => handleNavigateToTab(tab.id)}
              title={`${tab.label}${idx < 9 ? ` (${formatCombo(`CmdOrCtrl+${idx + 1}`)})` : ''}`}
              className={cn(
                'group flex items-center gap-1.5 px-3 h-full text-xs font-medium border-r border-border whitespace-nowrap transition-colors min-w-0 max-w-[200px] relative',
                isActive
                  ? 'bg-background text-foreground border-b border-b-background -mb-px'
                  : 'text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground'
              )}
            >
              {/* Active indicator — top bar */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary" />
              )}

              {/* Icon or running spinner */}
              {running ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
              ) : (
                Icon && <Icon className="h-3.5 w-3.5 shrink-0" />
              )}
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
