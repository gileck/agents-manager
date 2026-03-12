import React, { createContext, useContext } from 'react';
import type { ChatImage } from '../../../shared/types';

interface ChatActionsContextValue {
  sendMessage: (text: string, images?: ChatImage[]) => void;
  answerQuestion: (questionId: string, answers: Record<string, string>) => void;
  sessionId: string | null;
  isStreaming: boolean;
}

const defaultValue: ChatActionsContextValue = {
  sendMessage: () => {},
  answerQuestion: () => {},
  sessionId: null,
  isStreaming: false,
};

const ChatActionsContext = createContext<ChatActionsContextValue>(defaultValue);

interface ChatActionsProviderProps {
  sendMessage: (text: string, images?: ChatImage[]) => void;
  answerQuestion: (questionId: string, answers: Record<string, string>) => void;
  sessionId: string | null;
  isStreaming: boolean;
  children: React.ReactNode;
}

export function ChatActionsProvider({ sendMessage, answerQuestion, sessionId, isStreaming, children }: ChatActionsProviderProps) {
  return (
    <ChatActionsContext.Provider value={{ sendMessage, answerQuestion, sessionId, isStreaming }}>
      {children}
    </ChatActionsContext.Provider>
  );
}

export function useChatActions(): ChatActionsContextValue {
  return useContext(ChatActionsContext);
}
