import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useProjectChatSessions } from '../contexts/ProjectChatSessionsContext';
import { ChatPresetProvider } from '../components/chat/presets/ChatPresetContext';
import { PresetChatPanel } from '../components/chat/presets/PresetChatPanel';

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { currentProjectId } = useCurrentProject();
  const sessions = useProjectChatSessions();
  const { currentSessionId, sessions: sessionList, switchSession } = sessions;

  // Sync URL sessionId with the sessions context
  useEffect(() => {
    if (sessionId && currentSessionId !== sessionId) {
      const exists = sessionList.some(s => s.id === sessionId);
      if (exists) {
        switchSession(sessionId);
      }
    }
  }, [sessionId, currentSessionId, sessionList, switchSession]);

  if (!currentProjectId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl border border-border/70 bg-card/55 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="h-8 w-8 opacity-60" />
          </div>
          <p className="text-3xl font-semibold tracking-tight text-foreground">Select a project</p>
          <p className="text-sm mt-2">Choose a project from the top bar to start a thread</p>
        </div>
      </div>
    );
  }

  return (
    <ChatPresetProvider>
      <PresetChatPanel
        scope={{ type: 'project', id: currentProjectId }}
        sessionsOverride={sessions}
      />
    </ChatPresetProvider>
  );
}
