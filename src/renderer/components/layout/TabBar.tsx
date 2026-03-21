import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, Pin } from 'lucide-react';
import { cn, truncateString } from '../../lib/utils';
import { useTabsContext, ICON_MAP, getEntityId, type PageTab } from '../../contexts/TabsContext';
import { useActiveAgents } from '../../hooks/useActiveAgents';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { formatCombo } from '../../lib/keyboardShortcuts';
import { useKeyboardShortcutsConfig } from '../../hooks/useKeyboardShortcutsConfig';
import { reportError } from '../../lib/error-handler';

const MAX_LABEL_LENGTH = 24;

function isDefaultLabel(tab: PageTab): boolean {
  if (tab.identity.startsWith('task:')) {
    const id = getEntityId(tab.identity);
    return tab.label === `Task ${id?.slice(0, 8)}`;
  }
  if (tab.identity.startsWith('project:')) return tab.label === 'Project';
  if (tab.identity.startsWith('chat:')) return tab.label === 'Thread';
  return false;
}

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

export function TabBar() {
  const {
    state, config, switchTab, closeTab, closeOthers, closeToRight,
    getCloseTabTarget, updateTabLabel, pinTab, unpinTab, reorderTabs,
  } = useTabsContext();
  const { agents } = useActiveAgents();
  const { sessions } = useProjectChatSessions();
  const navigate = useNavigate();
  const { getCombo } = useKeyboardShortcutsConfig();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);
  const fetchingRef = useRef<Set<string>>(new Set());

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [state.activeTabId]);

  // Fetch real titles for entity tabs
  const fetchTitle = useCallback(async (tab: PageTab) => {
    const entityId = getEntityId(tab.identity);
    if (!entityId || fetchingRef.current.has(tab.identity)) return;
    fetchingRef.current.add(tab.identity);
    try {
      if (tab.identity.startsWith('task:')) {
        const task = await window.api.tasks.get(entityId);
        if (task?.title) updateTabLabel(tab.id, truncateString(task.title, MAX_LABEL_LENGTH));
      } else if (tab.identity.startsWith('project:')) {
        const project = await window.api.projects.get(entityId);
        if (project?.name) updateTabLabel(tab.id, truncateString(project.name, MAX_LABEL_LENGTH));
      }
    } catch (err) {
      reportError(err, 'TabBar: fetch entity title');
    } finally {
      fetchingRef.current.delete(tab.identity);
    }
  }, [updateTabLabel]);

  // Resolve tab labels — chat from context, task/project from API
  useEffect(() => {
    const toFetch: PageTab[] = [];
    for (const tab of state.tabs) {
      // Chat tabs: always sync with session name (handles renames & auto-naming)
      if (tab.identity.startsWith('chat:')) {
        const sessionId = getEntityId(tab.identity);
        const session = sessions.find(s => s.id === sessionId);
        if (session?.name) {
          const desired = truncateString(session.name, MAX_LABEL_LENGTH);
          if (tab.label !== desired) {
            updateTabLabel(tab.id, desired);
          }
        }
        continue;
      }
      // Task/project tabs: only fetch when still showing the default label
      if (!isDefaultLabel(tab)) continue;
      toFetch.push(tab);
    }
    if (toFetch.length > 0) {
      void Promise.all(toFetch.map(fetchTitle));
    }
  }, [state.tabs, sessions, fetchTitle, updateTabLabel]);

  // Memoize running agent Sets (includes waiting_for_input as active)
  const { runningTaskIds, runningSessionIds } = useMemo(() => {
    const taskIds = new Set<string>();
    const sessionIds = new Set<string>();
    for (const a of agents) {
      if (a.status === 'running' || a.status === 'waiting_for_input') {
        if (a.scopeType === 'task') taskIds.add(a.scopeId);
        sessionIds.add(a.sessionId);
      }
    }
    return { runningTaskIds: taskIds, runningSessionIds: sessionIds };
  }, [agents]);

  const isTabRunning = useCallback((tab: PageTab): boolean => {
    if (tab.identity.startsWith('task:')) {
      const taskId = getEntityId(tab.identity);
      return taskId ? runningTaskIds.has(taskId) : false;
    }
    if (tab.identity.startsWith('chat:')) {
      const sessionId = getEntityId(tab.identity);
      return sessionId ? runningSessionIds.has(sessionId) : false;
    }
    if (tab.identity === 'page:/chat') {
      return runningSessionIds.size > 0;
    }
    return false;
  }, [runningTaskIds, runningSessionIds]);

  if (!config.enabled || state.tabs.length === 0) {
    return null;
  }

  const handleNavigateToTab = (tabId: string) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) { switchTab(tabId); navigate(tab.path); }
  };

  const handleCloseTab = (tabId: string) => {
    const target = getCloseTabTarget(tabId);
    closeTab(tabId);
    if (target) navigate(target);
  };

  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) { e.preventDefault(); handleCloseTab(tabId); }
  };

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    dragIdxRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };
  const handleDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    const fromIdx = dragIdxRef.current;
    if (fromIdx !== null && fromIdx !== toIdx) reorderTabs(fromIdx, toIdx);
    dragIdxRef.current = null;
    setDragOverIdx(null);
  };
  const handleDragEnd = () => { dragIdxRef.current = null; setDragOverIdx(null); };

  const contextTab = contextMenu ? state.tabs.find(t => t.id === contextMenu.tabId) : null;
  const contextTabIdx = contextMenu ? state.tabs.findIndex(t => t.id === contextMenu.tabId) : -1;
  const portalTarget = document.getElementById('app-root') || document.body;

  return (
    <div className="flex items-stretch bg-muted shrink-0 overflow-hidden relative" style={{ height: 35 }}>
      <div
        ref={scrollRef}
        className="flex items-stretch flex-1 overflow-x-auto tabbar-scroll"
      >
        {state.tabs.map((tab, idx) => {
          const isActive = tab.id === state.activeTabId;
          const Icon = ICON_MAP[tab.iconName];
          const running = isTabRunning(tab);
          const isDragOver = dragOverIdx === idx;

          return (
            <div
              key={tab.id}
              ref={isActive ? activeTabRef : undefined}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              onClick={() => handleNavigateToTab(tab.id)}
              onMouseDown={(e) => handleMouseDown(e, tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNavigateToTab(tab.id); }}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              title={`${tab.label}${idx < 9 ? ` (${formatCombo(`CmdOrCtrl+${idx + 1}`)})` : ''}`}
              className={cn(
                'group relative flex items-center gap-1.5 h-full text-xs font-medium whitespace-nowrap cursor-pointer select-none border-r border-r-border/30',
                tab.isPinned ? 'px-2.5' : 'pl-3 pr-7',
                isActive
                  ? 'bg-background text-foreground border-t-2 border-t-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10 border-t-2 border-t-transparent',
                isDragOver && 'bg-accent/40'
              )}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
              ) : (
                Icon && <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              )}
              {!tab.isPinned && <span className="truncate max-w-[150px]">{tab.label}</span>}

              {/* Close button — absolutely positioned so it never shifts layout */}
              {!tab.isPinned && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleCloseTab(tab.id); } }}
                  title={`Close (${formatCombo(getCombo('tabs.closeTab'))})`}
                  className={cn(
                    'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 transition-opacity',
                    'opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:bg-foreground/10',
                    isActive && 'opacity-50'
                  )}
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Context menu — portaled per CLAUDE.md */}
      {contextMenu && contextTab && createPortal(
        <div
          className="absolute z-50 min-w-[160px] bg-popover border border-border rounded-md shadow-lg py-1 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y, position: 'fixed' }}
          onClick={() => setContextMenu(null)}
        >
          {contextTab.isPinned ? (
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
              onClick={() => unpinTab(contextTab.id)}
            >
              <Pin className="h-3 w-3" /> Unpin Tab
            </button>
          ) : (
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
              onClick={() => pinTab(contextTab.id)}
            >
              <Pin className="h-3 w-3" /> Pin Tab
            </button>
          )}
          <div className="h-px bg-border my-1" />
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
            onClick={() => handleCloseTab(contextTab.id)}
          >
            Close
          </button>
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
            onClick={() => closeOthers(contextTab.id)}
          >
            Close Others
          </button>
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
            disabled={contextTabIdx >= state.tabs.length - 1}
            onClick={() => closeToRight(contextTab.id)}
          >
            Close to the Right
          </button>
        </div>,
        portalTarget
      )}
    </div>
  );
}
