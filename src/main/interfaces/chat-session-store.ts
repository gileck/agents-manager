import type { ChatScopeType, ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput } from '../../shared/types';

// Re-export types from shared/types so existing consumers of this module are unaffected.
export type { ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput };

export interface IChatSessionStore {
  createSession(input: ChatSessionCreateInput): Promise<ChatSession>;
  getSession(id: string): Promise<ChatSession | null>;
  listSessionsForScope(scopeType: ChatScopeType, scopeId: string): Promise<ChatSession[]>;
  updateSession(id: string, input: ChatSessionUpdateInput): Promise<ChatSession | null>;
  deleteSession(id: string): Promise<boolean>;
}
