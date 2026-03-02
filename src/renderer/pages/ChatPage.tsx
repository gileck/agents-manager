import React from 'react';
import { MessageSquare } from 'lucide-react';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useProjectChatSessions } from '../contexts/ProjectChatSessionsContext';
import { ChatPanel } from '../components/chat/ChatPanel';

export function ChatPage() {
  const { currentProjectId } = useCurrentProject();
  const sessions = useProjectChatSessions();

  if (!currentProjectId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Select a project to start chatting</p>
          <p className="text-sm mt-1">Choose a project from the sidebar to begin</p>
        </div>
      </div>
    );
  }

  return (
    <ChatPanel
      scope={{ type: 'project', id: currentProjectId }}
      sessionsOverride={sessions}
    />
  );
}
