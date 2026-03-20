import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { CheckSquare, MessageSquare, FolderOpen, Settings, LayoutDashboard, Bot, Bug, Clock, GitBranch, DollarSign, Terminal, BarChart3, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { reportError } from '../lib/error-handler';

// --- Types ---

export interface PageTab {
  id: string;
  identity: string;       // dedup key: "task:123", "page:/chat", etc.
  path: string;           // current full route path
  label: string;
  iconName: string;       // lucide icon identifier
  lastAccessedAt: number;
}

export interface TabsState {
  tabs: PageTab[];
  activeTabId: string | null;
}

interface TabsConfig {
  enabled: boolean;
  maxOpenTabs: number;
}

// --- Tab identity computation ---

interface TabInfo {
  identity: string;
  label: string;
  iconName: string;
}

const STATIC_PAGES: Record<string, { label: string; iconName: string }> = {
  '/': { label: 'Dashboard', iconName: 'LayoutDashboard' },
  '/tasks': { label: 'Tasks', iconName: 'CheckSquare' },
  '/chat': { label: 'Chat', iconName: 'MessageSquare' },
  '/projects': { label: 'Projects', iconName: 'FolderOpen' },
  '/threads': { label: 'Thread History', iconName: 'Clock' },
  '/automated-agents': { label: 'Automations', iconName: 'Bot' },
  '/post-mortem': { label: 'Post-Mortem', iconName: 'Bug' },
  '/agent-runs': { label: 'Agent Runs', iconName: 'Zap' },
  '/features': { label: 'Features', iconName: 'BarChart3' },
  '/source-control': { label: 'Source Control', iconName: 'GitBranch' },
  '/cost': { label: 'Cost', iconName: 'DollarSign' },
  '/debug-logs': { label: 'Debug Logs', iconName: 'Terminal' },
};

export const ICON_MAP: Record<string, LucideIcon> = {
  CheckSquare, MessageSquare, FolderOpen, Settings, LayoutDashboard,
  Bot, Bug, Clock, GitBranch, DollarSign, Terminal, BarChart3, Zap,
};

export function computeTabInfo(pathname: string): TabInfo {
  // Settings — all sub-pages grouped under one tab
  if (pathname.startsWith('/settings')) {
    return { identity: 'page:/settings', label: 'Settings', iconName: 'Settings' };
  }

  // Task detail: /tasks/:id or /tasks/:id/plan, /tasks/:id/:tab, etc.
  const taskMatch = pathname.match(/^\/tasks\/([^/]+)/);
  if (taskMatch) {
    return { identity: `task:${taskMatch[1]}`, label: `Task ${taskMatch[1].slice(0, 8)}`, iconName: 'CheckSquare' };
  }

  // Project detail: /projects/:id or /projects/:id/telegram
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch) {
    return { identity: `project:${projectMatch[1]}`, label: `Project`, iconName: 'FolderOpen' };
  }

  // Agent run: /agents/:runId
  const agentRunMatch = pathname.match(/^\/agents\/([^/]+)/);
  if (agentRunMatch) {
    return { identity: `agent-run:${agentRunMatch[1]}`, label: 'Agent Run', iconName: 'Zap' };
  }

  // Feature detail: /features/:id
  const featureMatch = pathname.match(/^\/features\/([^/]+)/);
  if (featureMatch) {
    return { identity: `feature:${featureMatch[1]}`, label: 'Feature', iconName: 'BarChart3' };
  }

  // Automated agent detail/runs
  const autoAgentMatch = pathname.match(/^\/automated-agents\/(?:runs\/)?([^/]+)/);
  if (autoAgentMatch) {
    return { identity: `auto-agent:${autoAgentMatch[1]}`, label: 'Automation', iconName: 'Bot' };
  }

  // Static pages
  const staticPage = STATIC_PAGES[pathname];
  if (staticPage) {
    return { identity: `page:${pathname}`, label: staticPage.label, iconName: staticPage.iconName };
  }

  // Fallback
  return { identity: `page:${pathname}`, label: pathname.split('/').pop() || 'Page', iconName: 'LayoutDashboard' };
}

// --- Reducer ---

type TabsAction =
  | { type: 'OPEN_TAB'; path: string; identity: string; label: string; iconName: string; maxTabs: number }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'SWITCH_TAB'; tabId: string }
  | { type: 'UPDATE_TAB'; tabId: string; path?: string; label?: string }
  | { type: 'RESTORE'; state: TabsState };

let tabIdCounter = 0;
function nextTabId(): string {
  return `tab-${Date.now()}-${++tabIdCounter}`;
}

function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'OPEN_TAB': {
      const now = Date.now();
      // Check if tab with this identity already exists
      const existing = state.tabs.find(t => t.identity === action.identity);
      if (existing) {
        return {
          tabs: state.tabs.map(t =>
            t.id === existing.id
              ? { ...t, path: action.path, label: action.label, lastAccessedAt: now }
              : t
          ),
          activeTabId: existing.id,
        };
      }

      // Create new tab
      const newTab: PageTab = {
        id: nextTabId(),
        identity: action.identity,
        path: action.path,
        label: action.label,
        iconName: action.iconName,
        lastAccessedAt: now,
      };

      let tabs = [...state.tabs, newTab];

      // Evict LRU tabs if over max (safety floor of 1 to prevent infinite loop)
      const maxTabs = Math.max(action.maxTabs, 1);
      while (tabs.length > maxTabs) {
        const lru = tabs.reduce((min, t) =>
          t.id !== newTab.id && t.lastAccessedAt < min.lastAccessedAt ? t : min
        , tabs[0]);
        tabs = tabs.filter(t => t.id !== lru.id);
      }

      return { tabs, activeTabId: newTab.id };
    }

    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex(t => t.id === action.tabId);
      if (idx === -1) return state;

      const tabs = state.tabs.filter(t => t.id !== action.tabId);
      if (tabs.length === 0) {
        return { tabs: [], activeTabId: null };
      }

      let activeTabId = state.activeTabId;
      if (state.activeTabId === action.tabId) {
        // Activate adjacent: prefer right, then left
        const nextIdx = Math.min(idx, tabs.length - 1);
        activeTabId = tabs[nextIdx].id;
      }

      return { tabs, activeTabId };
    }

    case 'SWITCH_TAB': {
      const tab = state.tabs.find(t => t.id === action.tabId);
      if (!tab) return state;
      return {
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
    // Ensure activeTabId references an existing tab
    if (parsed.activeTabId && !parsed.tabs.some((t: PageTab) => t.id === parsed.activeTabId)) {
      parsed.activeTabId = parsed.tabs[0]?.id ?? null;
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
  const pages = getRecentPages().filter(p => p.path !== path);
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
  switchTab: (tabId: string) => void;
  updateTabLabel: (tabId: string, label: string) => void;
  getActiveTab: () => PageTab | undefined;
  setConfig: (config: Partial<TabsConfig>) => void;
  quickSwitcherOpen: boolean;
  setQuickSwitcherOpen: (open: boolean) => void;
  /** Returns the path to navigate to after closing a tab, or null if no navigation needed */
  getCloseTabTarget: (tabId: string) => string | null;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabsContext must be used within TabsProvider');
  return ctx;
}

const DEFAULT_STATE: TabsState = { tabs: [], activeTabId: null };

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

  // Load config from settings on mount
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

  // Persist tabs state on every change
  useEffect(() => {
    saveTabsState(state);
  }, [state]);

  const openTab = useCallback((path: string) => {
    const info = computeTabInfo(path);
    addRecentPage(path, info.label, info.iconName);

    if (!configRef.current.enabled) return;

    dispatch({
      type: 'OPEN_TAB',
      path,
      identity: info.identity,
      label: info.label,
      iconName: info.iconName,
      maxTabs: configRef.current.maxOpenTabs,
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    dispatch({ type: 'CLOSE_TAB', tabId });
  }, []);

  const switchTab = useCallback((tabId: string) => {
    dispatch({ type: 'SWITCH_TAB', tabId });
  }, []);

  const updateTabLabel = useCallback((tabId: string, label: string) => {
    dispatch({ type: 'UPDATE_TAB', tabId, label });
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

  return (
    <TabsContext.Provider value={{ state, config, openTab, closeTab, switchTab, updateTabLabel, getActiveTab, setConfig, quickSwitcherOpen, setQuickSwitcherOpen, getCloseTabTarget }}>
      {children}
    </TabsContext.Provider>
  );
}
