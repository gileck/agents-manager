import type { ChatScopeType } from '../../shared/types';

export interface ChatSession {
  id: string;
  projectId: string;
  scopeType: ChatScopeType;
  scopeId: string;
  name: string;
  agentLib: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSessionCreateInput {
  scopeType: ChatScopeType;
  scopeId: string;
  name: string;
  agentLib?: string;
}

export interface ChatSessionUpdateInput {
  name?: string;
  agentLib?: string | null;
}

export interface IChatSessionStore {
  createSession(input: ChatSessionCreateInput): Promise<ChatSession>;
  getSession(id: string): Promise<ChatSession | null>;
  listSessionsForScope(scopeType: ChatScopeType, scopeId: string): Promise<ChatSession[]>;
  updateSession(id: string, input: ChatSessionUpdateInput): Promise<ChatSession | null>;
  deleteSession(id: string): Promise<boolean>;
}
