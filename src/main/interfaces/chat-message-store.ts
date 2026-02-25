import type { ChatMessage, ChatMessageCreateInput } from '../../shared/types';

export interface IChatMessageStore {
  addMessage(input: ChatMessageCreateInput): Promise<ChatMessage>;
  getMessagesForSession(sessionId: string): Promise<ChatMessage[]>;
  clearMessages(sessionId: string): Promise<void>;
  replaceAllMessages(sessionId: string, messages: ChatMessageCreateInput[]): Promise<ChatMessage[]>;
  getCostSummary(): Promise<{ inputTokens: number; outputTokens: number }>;
}
