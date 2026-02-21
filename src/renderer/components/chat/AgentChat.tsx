import React from 'react';
import type { AgentChatMessage, AgentRun } from '../../../shared/types';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { ContextSidebar } from './ContextSidebar';

interface AgentChatProps {
  messages: AgentChatMessage[];
  isRunning: boolean;
  isQueued?: boolean;
  onSend: (message: string) => void;
  onStop?: () => void;
  showSidebar?: boolean;
  run?: AgentRun | null;
  emptyState?: React.ReactNode;
}

export function AgentChat({
  messages,
  isRunning,
  isQueued = false,
  onSend,
  onStop,
  showSidebar = false,
  run,
  emptyState,
}: AgentChatProps) {
  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-h-0 flex flex-col">
        {messages.length === 0 && !isRunning && emptyState ? (
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {emptyState}
          </div>
        ) : (
          <ChatMessageList messages={messages} isRunning={isRunning} />
        )}
        <ChatInput
          onSend={onSend}
          onStop={onStop}
          isRunning={isRunning}
          isQueued={isQueued}
        />
      </div>
      {showSidebar && (
        <ContextSidebar messages={messages} run={run ?? null} />
      )}
    </div>
  );
}
