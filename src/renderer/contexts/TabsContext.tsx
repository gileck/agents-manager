import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { reportError } from '../lib/error-handler';
import { STATIC_PAGES_MAP } from '../lib/pages';

// --- Types ---

export interface PageTab {
  id: string;
  identity: string;       // dedup key: "task:123", "page:/chat", etc.
  path: string;           // current full route path
  label: string;
  iconName: string;       // lucide icon identifier
  lastAccessedAt: number;
  isPinned: boolean;
}

export interface TabsState {
  tabs: PageTab[];
  activeTabId: string | null;
  recentlyClosed: PageTab[];  // stack of recently closed tabs (max 3)
}

interface TabsConfig {
  enabled: boolean;
  maxOpenTabs: number;
}

const MAX_RECENTLY_CLOSED = 3;

// --- Tab identity computation ---

interface TabInfo {
  identity: string;
  label: string;
  iconName: string;
}

// Re-export ICON_MAP so existing consumers (TabBar, QuickSwitcher) don't break
export { ICON_MAP } from '../lib/pages';

/** Extract the entity ID from a tab identity string (e.g., "task:abc123" → "abc123") */
export function getEntityId(identity: string): string | null {
  const idx = identity.indexOf(':');
  return idx >= 0 ? identity.slice(idx + 1) : null;
}

export function computeTabInfo(pathname: string): TabInfo {
  if (pathname.startsWith('/settings')) {
    return { identity: 'page:/settings', label: 'Settings', iconName: 'Settings' };
  }
  // Chat session: /chat/:sessionId
  const chatMatch = pathname.match(/^\/chat\/([^/]+)/);
  if (chatMatch) {
    return { identity: `chat:${chatMatch[1]}`, label: 'Thread', iconName: 'MessageSquare' };
  }

  const taskMatch = pathname.match(/^\/tasks\/([^/]+)/);
  if (taskMatch) {
    return { identity: `task:${taskMatch[1]}`, label: `Task ${taskMatch[1].slice(0, 8)}`, iconName: 'CheckSquare' };
  }
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch) {
    return { identity: `project:${projectMatch[1]}`, label: `Project`, iconName: 'FolderOpen' };
  }
  const agentRunMatch = pathname.match(/^\/agents\/([^/]+)/);
  if (agentRunMatch) {
    return { identity: `agent-run:${agentRunMatch[1]}`, label: 'Agent Run', iconName: 'Zap' };
  }
  const featureMatch = pathname.match(/^\/features\/([^/]+)/);
  if (featureMatch) {
    return { identity: `feature:${featureMatch[1]}`, label: 'Feature', iconName: 'BarChart3' };
  }
  const autoAgentMatch = pathname.match(/^\/automated-agents\/(?:runs\/)?([^/]+)/);
  if (autoAgentMatch) {
    return { identity: `auto-agent:${autoAgentMatch[1]}`, label: 'Automation', iconName: 'Bot' };
  }
  const staticPage = STATIC_PAGES_MAP[pathname];
  if (staticPage) {
    return { identity: `page:${pathname}`, label: staticPage.label, iconName: staticPage.iconName };
  }
  return { identity: `page:${pathname}`, label: pathname.split('/').pop() || 'Page', iconName: 'LayoutDashboard' };
}

// --- Reducer ---

type TabsAction =
  | { type: 'OPEN_TAB'; path: string; identity: string; label: string; iconName: string; maxTabs: number }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'CLOSE_OTHERS'; tabId: string }
  | { type: 'CLOSE_TO_RIGHT'; tabId: string }
  | { type: 'SWITCH_TAB'; tabId: string }
  | { type: 'UPDATE_TAB'; tabId: string; path?: string; label?: string }
  | { type: 'PIN_TAB'; tabId: string }
  | { type: 'UNPIN_TAB'; tabId: string }
  | { type: 'REORDER_TABS'; fromIndex: number; toIndex: number }
  | { type: 'REOPEN_TAB' }
  | { type: 'RESTORE'; state: TabsState };

let tabIdCounter = 0;
function nextTabId(): string {
  return `tab-${Date.now()}-${++tabIdCounter}`;
}

/** Push a tab onto the recently closed stack */
function pushClosed(recentlyClosed: PageTab[], tab: PageTab): PageTab[] {
  const stack = [tab, ...recentlyClosed];
  if (stack.length > MAX_RECENTLY_CLOSED) stack.length = MAX_RECENTLY_CLOSED;
  return stack;
}

/** Push multiple tabs onto the recently closed stack */
function pushClosedMany(recentlyClosed: PageTab[], tabs: PageTab[]): PageTab[] {
  const stack = [...tabs, ...recentlyClosed];
  if (stack.length > MAX_RECENTLY_CLOSED) stack.length = MAX_RECENTLY_CLOSED;
  return stack;
}

function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'OPEN_TAB': {
      const now = Date.now();
      const existing = state.tabs.find(t => t.identity === action.identity);
      if (existing) {
        return {
          ...state,
          tabs: state.tabs.map(t =>
            t.id === existing.id
              ? { ...t, path: action.path, lastAccessedAt: now }
              : t
          ),
          activeTabId: existing.id,
        };
      }

      const newTab: PageTab = {
        id: nextTabId(),
        identity: action.identity,
        path: action.path,
        label: action.label,
        iconName: action.iconName,
        lastAccessedAt: now,
        isPinned: false,
      };

      let tabs = [...state.tabs, newTab];
      let { recentlyClosed } = state;

      // Evict LRU unpinned tabs if over max
      const maxTabs = Math.max(action.maxTabs, 1);
      while (tabs.length > maxTabs) {
        const unpinned = tabs.filter(t => !t.isPinned && t.id !== newTab.id);
        if (unpinned.length === 0) break; // all pinned + new tab, can't evict
        const lru = unpinned.reduce((min, t) =>
          t.lastAccessedAt < min.lastAccessedAt ? t : min
        , unpinned[0]);
        recentlyClosed = pushClosed(recentlyClosed, lru);
        tabs = tabs.filter(t => t.id !== lru.id);
      }

      return { tabs, activeTabId: newTab.id, recentlyClosed };
    }

    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex(t => t.id === action.tabId);
      if (idx === -1) return state;

      const closedTab = state.tabs[idx];
      const tabs = state.tabs.filter(t => t.id !== action.tabId);
      const recentlyClosed = pushClosed(state.recentlyClosed, closedTab);

      if (tabs.length === 0) {
        return { tabs: [], activeTabId: null, recentlyClosed };
      }

      let activeTabId = state.activeTabId;
      if (state.activeTabId === action.tabId) {
        const nextIdx = Math.min(idx, tabs.length - 1);
        activeTabId = tabs[nextIdx].id;
      }

      return { tabs, activeTabId, recentlyClosed };
    }

    case 'CLOSE_OTHERS': {
      const keep = state.tabs.find(t => t.id === action.tabId);
      if (!keep) return state;
      const closed = state.tabs.filter(t => t.id !== action.tabId && !t.isPinned);
      const tabs = state.tabs.filter(t => t.id === action.tabId || t.isPinned);
      return {
        tabs,
        activeTabId: keep.id,
        recentlyClosed: pushClosedMany(state.recentlyClosed, closed),
      };
    }

    case 'CLOSE_TO_RIGHT': {
      const idx = state.tabs.findIndex(t => t.id === action.tabId);
      if (idx === -1) return state;
      const closed = state.tabs.slice(idx + 1).filter(t => !t.isPinned);
      const tabs = state.tabs.filter((t, i) => i <= idx || t.isPinned);
      let activeTabId = state.activeTabId;
      if (activeTabId && !tabs.some(t => t.id === activeTabId)) {
        activeTabId = action.tabId;
      }
      return {
        tabs,
        activeTabId,
        recentlyClosed: pushClosedMany(state.recentlyClosed, closed),
      };
    }

    case 'SWITCH_TAB': {
      const tab = state.tabs.find(t => t.id === action.tabId);
      if (!tab) return state;
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.tabId ? { ...t, lastAccessedAt: Date.now() } : t
        ),
        activeTabId: action.tabId,
      };
    }

    case 'UPDATE_TAB': {
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.tabId
            ? { ...t, ...(action.path !== undefined && { path: action.path }), ...(action.label !== undefined && { label: action.label }) }
            : t
        ),
      };
    }

    case 'PIN_TAB': {
      const tab = state.tabs.find(t => t.id === action.tabId);
      if (!tab || tab.isPinned) return state;
      // Move pinned tab to the end of the pinned group (left side)
      const pinned = state.tabs.filter(t => t.isPinned);
      const unpinned = state.tabs.filter(t => !t.isPinned && t.id !== action.tabId);
      const pinnedTab = { ...tab, isPinned: true };
      return { ...state, tabs: [...pinned, pinnedTab, ...unpinned] };
    }

    case 'UNPIN_TAB': {
      const tab = state.tabs.find(t => t.id === action.tabId);
      if (!tab || !tab.isPinned) return state;
      // Move unpinned tab to the start of unpinned group (after all pinned)
      const pinned = state.tabs.filter(t => t.isPinned && t.id !== action.tabId);
      const unpinned = state.tabs.filter(t => !t.isPinned);
      const unpinnedTab = { ...tab, isPinned: false };
      return { ...state, tabs: [...pinned, unpinnedTab, ...unpinned] };
    }

    case 'REORDER_TABS': {
      const { fromIndex, toIndex } = action;
      if (fromIndex === toIndex) return state;
      if (fromIndex < 0 || fromIndex >= state.tabs.length) return state;
      if (toIndex < 0 || toIndex >= state.tabs.length) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { ...state, tabs };
    }

    case 'REOPEN_TAB': {
      if (state.recentlyClosed.length === 0) return state;
      const [tab, ...rest] = state.recentlyClosed;
      // Don't reopen if identity already exists
      if (state.tabs.some(t => t.identity === tab.identity)) {
        return { ...state, recentlyClosed: rest };
      }
      const reopened = { ...tab, id: nextTabId(), lastAccessedAt: Date.now() };
      return {
        tabs: [...state.tabs, reopened],
        activeTabId: reopened.id,
        recentlyClosed: rest,
      };
    }

    case 'RESTORE': {
      return action.state;
    }

    default:
      return state;
  }
}

// --- Persistence ---

const STORAGE_KEY = 'page-tabs-v1';
const RECENT_PAGES_KEY = 'recent-pages-v1';
const MAX_RECENT = 20;

function saveTabsState(state: TabsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[TabsContext] Failed to persist tabs state:', err);
  }
}

function loadTabsState(): TabsState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tabs)) return null;
    if (parsed.activeTabId && !parsed.tabs.some((t: PageTab) => t.id === parsed.activeTabId)) {
      parsed.activeTabId = parsed.tabs[0]?.id ?? null;
    }
    // Ensure isPinned exists on all tabs (migration from v1 without pin support)
    for (const tab of parsed.tabs) {
      if (tab.isPinned === undefined) tab.isPinned = false;
    }
    if (!Array.isArray(parsed.recentlyClosed)) {
      parsed.recentlyClosed = [];
    }
    return parsed as TabsState;
  } catch (err) {
    console.warn('[TabsContext] Failed to load tabs state:', err);
    return null;
  }
}

export interface RecentPage {
  path: string;
  label: string;
  iconName: string;
  visitedAt: number;
}

export function getRecentPages(): RecentPage[] {
  try {
    const raw = localStorage.getItem(RECENT_PAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    console.warn('[TabsContext] Failed to load recent pages:', err);
    return [];
  }
}

export function addRecentPage(path: string, label: string, iconName: string) {
  const existing = getRecentPages();
  // Skip if already at the head of the list
  if (existing[0]?.path === path) return;
  const pages = existing.filter(p => p.path !== path);
  pages.unshift({ path, label, iconName, visitedAt: Date.now() });
  if (pages.length > MAX_RECENT) pages.length = MAX_RECENT;
  try {
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(pages));
  } catch (err) {
    console.warn('[TabsContext] Failed to persist recent pages:', err);
  }
}

// --- Context ---

interface TabsContextValue {
  state: TabsState;
  config: TabsConfig;
  openTab: (path: string) => void;
  closeTab: (tabId: string) => void;
  closeOthers: (tabId: string) => void;
  closeToRight: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  updateTabLabel: (tabId: string, label: string) => void;
  pinTab: (tabId: string) => void;
  unpinTab: (tabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  reopenTab: () => void;
  getActiveTab: () => PageTab | undefined;
  setConfig: (config: Partial<TabsConfig>) => void;
  quickSwitcherOpen: boolean;
  setQuickSwitcherOpen: (open: boolean) => void;
  getCloseTabTarget: (tabId: string) => string | null;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabsContext must be used within TabsProvider');
  return ctx;
}

const DEFAULT_STATE: TabsState = { tabs: [], activeTabId: null, recentlyClosed: [] };

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(tabsReducer, DEFAULT_STATE, () => {
    return loadTabsState() || DEFAULT_STATE;
  });

  const [config, setConfigState] = React.useState<TabsConfig>({
    enabled: true,
    maxOpenTabs: 5,
  });

  const [quickSwitcherOpen, setQuickSwitcherOpen] = React.useState(false);

  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const settingsApi = window.api?.settings;
    if (!settingsApi?.get) return;
    settingsApi.get().then((settings) => {
      setConfigState({
        enabled: settings.tabsEnabled ?? true,
        maxOpenTabs: settings.tabsMaxOpen ?? 5,
      });
    }).catch((err) => reportError(err, 'TabsContext: load tab settings'));
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveTabsState(state), 150);
    return () => clearTimeout(saveTimerRef.current);
  }, [state]);

  const openTab = useCallback((path: string) => {
    const info = computeTabInfo(path);
    addRecentPage(path, info.label, info.iconName);
    if (!configRef.current.enabled) return;
    dispatch({
      type: 'OPEN_TAB', path,
      identity: info.identity, label: info.label, iconName: info.iconName,
      maxTabs: configRef.current.maxOpenTabs,
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    dispatch({ type: 'CLOSE_TAB', tabId });
  }, []);

  const closeOthers = useCallback((tabId: string) => {
    dispatch({ type: 'CLOSE_OTHERS', tabId });
  }, []);

  const closeToRight = useCallback((tabId: string) => {
    dispatch({ type: 'CLOSE_TO_RIGHT', tabId });
  }, []);

  const switchTab = useCallback((tabId: string) => {
    dispatch({ type: 'SWITCH_TAB', tabId });
  }, []);

  const updateTabLabel = useCallback((tabId: string, label: string) => {
    dispatch({ type: 'UPDATE_TAB', tabId, label });
  }, []);

  const pinTab = useCallback((tabId: string) => {
    dispatch({ type: 'PIN_TAB', tabId });
  }, []);

  const unpinTab = useCallback((tabId: string) => {
    dispatch({ type: 'UNPIN_TAB', tabId });
  }, []);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    dispatch({ type: 'REORDER_TABS', fromIndex, toIndex });
  }, []);

  const reopenTab = useCallback(() => {
    dispatch({ type: 'REOPEN_TAB' });
  }, []);

  const getActiveTab = useCallback(() => {
    return state.tabs.find(t => t.id === state.activeTabId);
  }, [state]);

  const setConfig = useCallback((updates: Partial<TabsConfig>) => {
    setConfigState(prev => ({ ...prev, ...updates }));
  }, []);

  const getCloseTabTarget = useCallback((tabId: string): string | null => {
    const idx = state.tabs.findIndex(t => t.id === tabId);
    const isActive = tabId === state.activeTabId;
    if (!isActive) return null;
    if (state.tabs.length <= 1) return '/';
    const remaining = state.tabs.filter(t => t.id !== tabId);
    const nextIdx = Math.min(idx, remaining.length - 1);
    return remaining[nextIdx]?.path ?? '/';
  }, [state]);

  const value: TabsContextValue = {
    state, config, openTab, closeTab, closeOthers, closeToRight,
    switchTab, updateTabLabel, pinTab, unpinTab, reorderTabs, reopenTab,
    getActiveTab, setConfig, quickSwitcherOpen, setQuickSwitcherOpen, getCloseTabTarget,
  };

  return (
    <TabsContext.Provider value={value}>
      {children}
    </TabsContext.Provider>
  );
}
