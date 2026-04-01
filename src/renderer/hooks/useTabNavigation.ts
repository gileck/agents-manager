import { useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTabsContext } from '../contexts/TabsContext';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useKeyboardShortcutsConfig } from './useKeyboardShortcutsConfig';
import { matchesKeyEvent } from '../lib/keyboardShortcuts';

/**
 * Intercepts React Router navigation to manage page tabs.
 * Also handles tab keyboard shortcuts globally.
 * Replaces useRouteRestore — saves/restores active tab on startup.
 */
export function useTabNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, config, openTab, closeTab, switchTab, setQuickSwitcherOpen, getCloseTabTarget, reopenTab } = useTabsContext();
  const { currentProjectId } = useCurrentProject();
  const { getCombo } = useKeyboardShortcutsConfig();
  const hasRestored = useRef(false);

  // Restore active tab's path on initial mount
  useEffect(() => {
    if (hasRestored.current) return;
    hasRestored.current = true;

    if (config.enabled && state.activeTabId) {
      const activeTab = state.tabs.find(t => t.id === state.activeTabId);
      if (activeTab && activeTab.path !== '/' && activeTab.path !== location.pathname) {
        navigate(activeTab.path, { replace: true });
      }
    } else {
      // Fallback to old route restore behavior
      try {
        const routeKey = currentProjectId ? `app.lastRoute:${currentProjectId}` : 'app.lastRoute';
        const saved = localStorage.getItem(routeKey);
        if (saved && saved.startsWith('/') && saved !== '/' && saved !== location.pathname) {
          navigate(saved, { replace: true });
        }
      } catch {
        // localStorage not available — skip route restore
      }
    }
  }, []);

  // Track location changes → open/update tabs
  useEffect(() => {
    openTab(location.pathname);
    try {
      const routeKey = currentProjectId ? `app.lastRoute:${currentProjectId}` : 'app.lastRoute';
      localStorage.setItem(routeKey, location.pathname);
    } catch {
      // localStorage may be unavailable — non-critical
    }
  }, [location.pathname, openTab, currentProjectId]);

  // Navigate to a specific tab
  const navigateToTab = useCallback((tabId: string) => {
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) {
      switchTab(tabId);
      navigate(tab.path);
    }
  }, [state.tabs, switchTab, navigate]);

  // Close a tab and navigate to the next active one
  const handleCloseTab = useCallback((tabId: string) => {
    const target = getCloseTabTarget(tabId);
    closeTab(tabId);
    if (target) {
      navigate(target);
    }
  }, [getCloseTabTarget, closeTab, navigate]);

  // Global shortcuts — work regardless of tab config
  useEffect(() => {
    const handleGlobalShortcuts = (event: KeyboardEvent) => {
      if (matchesKeyEvent(getCombo('global.search'), event)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('open-global-search'));
        return;
      }
      if (matchesKeyEvent(getCombo('global.projectPicker'), event)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('open-project-picker'));
        return;
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [getCombo]);

  // Global keyboard shortcuts for tabs
  useEffect(() => {
    if (!config.enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Close tab
      if (matchesKeyEvent(getCombo('tabs.closeTab'), event)) {
        event.preventDefault();
        if (state.activeTabId) {
          handleCloseTab(state.activeTabId);
        }
        return;
      }

      // Previous tab
      if (matchesKeyEvent(getCombo('tabs.prevTab'), event)) {
        event.preventDefault();
        const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
        if (idx > 0) {
          navigateToTab(state.tabs[idx - 1].id);
        }
        return;
      }

      // Next tab
      if (matchesKeyEvent(getCombo('tabs.nextTab'), event)) {
        event.preventDefault();
        const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
        if (idx >= 0 && idx < state.tabs.length - 1) {
          navigateToTab(state.tabs[idx + 1].id);
        }
        return;
      }

      // Quick switcher
      if (matchesKeyEvent(getCombo('tabs.quickSwitcher'), event)) {
        event.preventDefault();
        setQuickSwitcherOpen(true);
        return;
      }

      // Reopen last closed tab
      if (matchesKeyEvent(getCombo('tabs.reopenTab'), event)) {
        event.preventDefault();
        const closedTab = state.recentlyClosed?.[0];
        if (closedTab) {
          reopenTab();
          navigate(closedTab.path);
        }
        return;
      }

      // Jump to tab by index (Cmd+1 through Cmd+9)
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
        const digit = parseInt(event.key, 10);
        if (digit >= 1 && digit <= 9) {
          const target = state.tabs[digit - 1];
          if (target) {
            event.preventDefault();
            navigateToTab(target.id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [config.enabled, state.tabs, state.activeTabId, state.recentlyClosed, getCombo, navigateToTab, handleCloseTab, setQuickSwitcherOpen, reopenTab, navigate]);

  return { navigateToTab, handleCloseTab };
}
