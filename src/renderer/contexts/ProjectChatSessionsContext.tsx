import React, { createContext, useContext, useMemo } from 'react';
import { useChatSessions } from '../hooks/useChatSessions';
import { useCurrentProject } from './CurrentProjectContext';

type ChatSessionsValue = ReturnType<typeof useChatSessions>;

const ProjectChatSessionsContext = createContext<ChatSessionsValue | null>(null);

export function ProjectChatSessionsProvider({ children }: { children: React.ReactNode }) {
  const { currentProjectId } = useCurrentProject();
  const scope = useMemo(
    () => currentProjectId ? { type: 'project' as const, id: currentProjectId } : null,
    [currentProjectId],
  );
  const value = useChatSessions(scope);
  return (
    <ProjectChatSessionsContext.Provider value={value}>
      {children}
    </ProjectChatSessionsContext.Provider>
  );
}

export function useProjectChatSessions(): ChatSessionsValue {
  const ctx = useContext(ProjectChatSessionsContext);
  if (!ctx) throw new Error('useProjectChatSessions must be used within ProjectChatSessionsProvider');
  return ctx;
}
