import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Project } from '../../shared/types';

interface CurrentProjectContextValue {
  currentProjectId: string | null;
  currentProject: Project | null;
  loading: boolean;
  setCurrentProjectId: (id: string | null) => Promise<void>;
}

const CurrentProjectContext = createContext<CurrentProjectContextValue>({
  currentProjectId: null,
  currentProject: null,
  loading: true,
  setCurrentProjectId: async () => {},
});

export function CurrentProjectProvider({ children }: { children: React.ReactNode }) {
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(null);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

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
        await window.api.settings.update({ currentProjectId: null });
      }
    } catch {
      setCurrentProject(null);
      setCurrentProjectIdState(null);
      try {
        await window.api.settings.update({ currentProjectId: null });
      } catch {
        // best-effort cleanup
      }
    }
  }, []);

  // Initialize from settings on mount
  useEffect(() => {
    (async () => {
      try {
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
      } finally {
        setLoading(false);
      }
    })();
  }, [loadProject]);

  const setCurrentProjectId = useCallback(async (id: string | null) => {
    setCurrentProjectIdState(id);
    await window.api.settings.update({ currentProjectId: id });
    await loadProject(id);
  }, [loadProject]);

  return (
    <CurrentProjectContext.Provider value={{ currentProjectId, currentProject, loading, setCurrentProjectId }}>
      {children}
    </CurrentProjectContext.Provider>
  );
}

export function useCurrentProject() {
  return useContext(CurrentProjectContext);
}
