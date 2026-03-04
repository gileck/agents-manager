import React from 'react';
import type { AgentChatMessage, AgentRun, ChatImage } from '../../../shared/types';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput, AgentLibOption, ModelOption } from './ChatInput';
import { ContextSidebar } from './ContextSidebar';

interface AgentChatProps {
  messages: AgentChatMessage[];
  isRunning: boolean;
  isQueued?: boolean;
  onSend: (message: string, images?: ChatImage[]) => void;
  onStop?: () => void;
  showSidebar?: boolean;
  run?: AgentRun | null;
  emptyState?: React.ReactNode;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  agentLibs?: AgentLibOption[];
  selectedAgentLib?: string;
  onAgentLibChange?: (lib: string) => void;
  models?: ModelOption[];
  selectedModel?: string;
  onModelChange?: (model: string) => void;
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
  tokenUsage,
  agentLibs,
  selectedAgentLib,
  onAgentLibChange,
  models,
  selectedModel,
  onModelChange,
}: AgentChatProps) {
  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-h-0 flex flex-col">
        {messages.length === 0 && !isRunning && emptyState ? (
          <div className="flex-1 flex items-center justify-center px-4 py-2">
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
          tokenUsage={tokenUsage}
          agentLibs={agentLibs}
          selectedAgentLib={selectedAgentLib}
          onAgentLibChange={onAgentLibChange}
          models={models}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
        />
      </div>
      {showSidebar && (
        <ContextSidebar messages={messages} run={run ?? null} />
      )}
    </div>
  );
}
