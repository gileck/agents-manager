import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, Pin } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTabsContext, ICON_MAP, type PageTab } from '../../contexts/TabsContext';
import { useActiveAgents } from '../../hooks/useActiveAgents';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { formatCombo } from '../../lib/keyboardShortcuts';
import { useKeyboardShortcutsConfig } from '../../hooks/useKeyboardShortcutsConfig';
import { reportError } from '../../lib/error-handler';

const MAX_LABEL_LENGTH = 24;

function getEntityId(identity: string): string | null {
  const idx = identity.indexOf(':');
  return idx >= 0 ? identity.slice(idx + 1) : null;
}

function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label;
  return label.slice(0, MAX_LABEL_LENGTH - 1) + '…';
}

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

// --- Context menu ---

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
  const { sessions, currentSessionId } = useProjectChatSessions();
  const navigate = useNavigate();
  const { getCombo } = useKeyboardShortcutsConfig();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const fetchingRef = useRef<Set<string>>(new Set());

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Drag state
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // Scroll active tab into view
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [state.activeTabId]);

  // Fetch real titles
  const fetchTitle = useCallback(async (tab: PageTab) => {
    const entityId = getEntityId(tab.identity);
    if (!entityId || fetchingRef.current.has(tab.identity)) return;
    fetchingRef.current.add(tab.identity);
    try {
      if (tab.identity.startsWith('task:')) {
        const task = await window.api.tasks.get(entityId);
        if (task?.title) updateTabLabel(tab.id, truncateLabel(task.title));
      } else if (tab.identity.startsWith('project:')) {
        const project = await window.api.projects.get(entityId);
        if (project?.name) updateTabLabel(tab.id, truncateLabel(project.name));
      }
    } catch (err) {
      reportError(err, 'TabBar: fetch entity title');
    } finally {
      fetchingRef.current.delete(tab.identity);
    }
  }, [updateTabLabel]);

  useEffect(() => {
    for (const tab of state.tabs) {
      if (isDefaultLabel(tab)) fetchTitle(tab);
    }
  }, [state.tabs, fetchTitle]);

  // Update chat tab label with current session name
  useEffect(() => {
    if (!currentSessionId || !sessions.length) return;
    const chatTab = state.tabs.find(t => t.identity === 'page:/chat');
    if (!chatTab) return;
    const session = sessions.find(s => s.id === currentSessionId);
    if (session?.name && chatTab.label !== truncateLabel(session.name)) {
      updateTabLabel(chatTab.id, truncateLabel(session.name));
    }
  }, [currentSessionId, sessions, state.tabs, updateTabLabel]);

  if (!config.enabled || state.tabs.length === 0) {
    return null;
  }

  // Running agent detection
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
    if (tab) { switchTab(tabId); navigate(tab.path); }
  };

  const handleCloseTab = (tabId: string) => {
    const target = getCloseTabTarget(tabId);
    closeTab(tabId);
    if (target) navigate(target);
  };

  // Middle-click to close
  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      handleCloseTab(tabId);
    }
  };

  // Context menu
  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  };

  // Drag handlers
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
    if (fromIdx !== null && fromIdx !== toIdx) {
      reorderTabs(fromIdx, toIdx);
    }
    dragIdxRef.current = null;
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    dragIdxRef.current = null;
    setDragOverIdx(null);
  };

  const contextTab = contextMenu ? state.tabs.find(t => t.id === contextMenu.tabId) : null;
  const contextTabIdx = contextMenu ? state.tabs.findIndex(t => t.id === contextMenu.tabId) : -1;

  return (
    <div className="flex items-center bg-muted/40 h-9 shrink-0 overflow-hidden relative">
      <div
        ref={scrollRef}
        className="flex items-stretch flex-1 overflow-x-auto scrollbar-none"
      >
        {state.tabs.map((tab, idx) => {
          const isActive = tab.id === state.activeTabId;
          const Icon = ICON_MAP[tab.iconName];
          const running = isTabRunning(tab);
          const isDragOver = dragOverIdx === idx;

          return (
            <button
              key={tab.id}
              ref={isActive ? activeTabRef : undefined}
              onClick={() => handleNavigateToTab(tab.id)}
              onMouseDown={(e) => handleMouseDown(e, tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              title={`${tab.label}${idx < 9 ? ` (${formatCombo(`CmdOrCtrl+${idx + 1}`)})` : ''}`}
              className={cn(
                'group flex items-center gap-1.5 h-full text-xs font-medium whitespace-nowrap transition-colors relative box-border border-t-2',
                tab.isPinned ? 'px-2 w-9 justify-center' : 'px-3 min-w-0 max-w-[200px]',
                isActive
                  ? 'bg-background text-foreground border-t-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border-t-transparent',
                isDragOver && 'bg-accent/30'
              )}
            >

              {/* Icon or running spinner */}
              {running ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
              ) : (
                Icon && <Icon className="h-3.5 w-3.5 shrink-0" />
              )}

              {/* Label — hidden for pinned tabs */}
              {!tab.isPinned && (
                <span className="truncate">{tab.label}</span>
              )}

              {/* Close button — not shown for pinned tabs */}
              {!tab.isPinned && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleCloseTab(tab.id); } }}
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
              )}
            </button>
          );
        })}
      </div>

      {/* Context menu */}
      {contextMenu && contextTab && (
        <div
          className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-md shadow-lg py-1 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
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
        </div>
      )}
    </div>
  );
}
