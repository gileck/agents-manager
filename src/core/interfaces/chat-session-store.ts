import type { ChatScopeType, ChatSessionSource, ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput, TaskChatSessionWithTitle } from '../../shared/types';

// Re-export types from shared/types so existing consumers of this module are unaffected.
export type { ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput };

export interface ListSessionsOptions {
  excludeSources?: ChatSessionSource[];
}

export interface IChatSessionStore {
  createSession(input: ChatSessionCreateInput): Promise<ChatSession>;
  getSession(id: string): Promise<ChatSession | null>;
  listSessionsForScope(scopeType: ChatScopeType, scopeId: string, options?: ListSessionsOptions): Promise<ChatSession[]>;
  listTaskSessionsForProject(projectId: string, options?: ListSessionsOptions): Promise<TaskChatSessionWithTitle[]>;
  updateSession(id: string, input: ChatSessionUpdateInput): Promise<ChatSession | null>;
  deleteSession(id: string): Promise<boolean>;
}
