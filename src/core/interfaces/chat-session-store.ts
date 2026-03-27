import type { ChatScopeType, ChatSessionSource, ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput, ChatSessionStatus, ChatSessionWithDetails, TaskChatSessionWithTitle } from '../../shared/types';

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
  listAllForProject(projectId: string): Promise<ChatSessionWithDetails[]>;
  updateSession(id: string, input: ChatSessionUpdateInput): Promise<ChatSession | null>;
  deleteSession(id: string): Promise<boolean>;
  hideSession(id: string): Promise<boolean>;
  unhideSession(id: string): Promise<boolean>;
  hideAllSessions(projectId: string): Promise<boolean>;
  addTrackedTask(sessionId: string, taskId: string): Promise<void>;
  removeTrackedTask(sessionId: string, taskId: string): Promise<void>;
  getTrackedTaskIds(sessionId: string): Promise<string[]>;
  updateSessionStatus(id: string, status: ChatSessionStatus): Promise<void>;
  resetStaleStatuses(): Promise<void>;
}
