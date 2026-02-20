import type { ChatMessage, ChatMessageCreateInput } from '../../shared/types';

export interface IChatMessageStore {
  addMessage(input: ChatMessageCreateInput): Promise<ChatMessage>;
  getMessagesForProject(projectId: string): Promise<ChatMessage[]>;
  clearMessages(projectId: string): Promise<void>;
  replaceAllMessages(projectId: string, messages: ChatMessageCreateInput[]): Promise<ChatMessage[]>;
}
