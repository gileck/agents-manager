import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { Project } from '../../shared/types';
import { getProjectIdFromUrl } from '../lib/project-scope';
import { reportError } from '../lib/error-handler';

interface CurrentProjectContextValue {
  currentProjectId: string | null;
  currentProject: Project | null;
  loading: boolean;
  /** When true, the project is locked to this window via URL — switching opens a new window. */
  isLocked: boolean;
  setCurrentProjectId: (id: string | null) => Promise<void>;
}

const CurrentProjectContext = createContext<CurrentProjectContextValue>({
  currentProjectId: null,
  currentProject: null,
  loading: true,
  isLocked: false,
  setCurrentProjectId: async () => {},
});

/** projectId baked into the URL at window creation time (immutable for the lifetime of this window). */
const urlProjectId = getProjectIdFromUrl();

export function CurrentProjectProvider({ children }: { children: React.ReactNode }) {
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(urlProjectId);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  // URL-scoped windows become unlocked if the project is deleted/not found
  const [isLocked, setIsLocked] = useState(!!urlProjectId);

  // Load project object for a given ID
  const loadProject = useCallback(async (id: string | null) => {
    if (!id) {
      setCurrentProject(null);
      return;
    }
    try {
      const project = await window.api.projects.get(id);
      if (project) {
        setCurrentProject(project);
      } else {
        // Project was deleted — clear selection
        setCurrentProject(null);
        setCurrentProjectIdState(null);
        // If this was a URL-scoped window, unlock it so the user can pick another project
        if (urlProjectId) {
          setIsLocked(false);
        } else {
          await window.api.settings.update({ currentProjectId: null });
        }
      }
    } catch (err) {
      reportError(err, 'Load project');
      setCurrentProject(null);
      setCurrentProjectIdState(null);
      if (urlProjectId) {
        setIsLocked(false);
      } else {
        try {
          await window.api.settings.update({ currentProjectId: null });
        } catch (cleanupErr) {
          reportError(cleanupErr, 'Clear project setting');
        }
      }
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    (async () => {
      try {
        if (urlProjectId) {
          // URL-scoped: use the URL projectId directly, skip global settings
          await loadProject(urlProjectId);
        } else {
          // Fallback: read from global settings (backwards compat, first launch)
          const settings = await window.api.settings.get();
          const storedId = settings.currentProjectId;

          if (storedId) {
            setCurrentProjectIdState(storedId);
            await loadProject(storedId);
          } else {
            // Auto-select first project if none stored
            const projects = await window.api.projects.list();
            if (projects.length > 0) {
              const firstId = projects[0].id;
              setCurrentProjectIdState(firstId);
              setCurrentProject(projects[0]);
              await window.api.settings.update({ currentProjectId: firstId });
            }
          }
        }
      } catch (err) {
        reportError(err, 'Initialize project context');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadProject]);

  const setCurrentProjectId = useCallback(async (id: string | null) => {
    // Switching to a different project always opens a new window
    if (id && id !== currentProjectId && currentProjectId) {
      try {
        await window.api.window.openProject(id);
      } catch (err) {
        reportError(err, 'Open project in new window');
      }
      return;
    }
    if (isLocked) {
      // URL-scoped: only update local state, never mutate global settings
      setCurrentProjectIdState(id);
      if (id) {
        await loadProject(id);
      } else {
        setCurrentProject(null);
      }
      return;
    }
    // Not URL-scoped: update local state + global settings
    // (used for initial project selection when no project is set yet)
    try {
      setCurrentProjectIdState(id);
      await window.api.settings.update({ currentProjectId: id });
      await loadProject(id);
    } catch (err) {
      reportError(err, 'Switch project');
    }
  }, [loadProject, isLocked, currentProjectId]);

  const value = useMemo(() => ({
    currentProjectId,
    currentProject,
    loading,
    isLocked,
    setCurrentProjectId,
  }), [currentProjectId, currentProject, loading, isLocked, setCurrentProjectId]);

  return (
    <CurrentProjectContext.Provider value={value}>
      {children}
    </CurrentProjectContext.Provider>
  );
}

export function useCurrentProject() {
  return useContext(CurrentProjectContext);
}
