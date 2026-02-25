export interface ChatSession {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSessionCreateInput {
  projectId: string;
  name: string;
}

export interface ChatSessionUpdateInput {
  name: string;
}

export interface IChatSessionStore {
  createSession(input: ChatSessionCreateInput): Promise<ChatSession>;
  getSession(id: string): Promise<ChatSession | null>;
  listSessionsForProject(projectId: string): Promise<ChatSession[]>;
  updateSession(id: string, input: ChatSessionUpdateInput): Promise<ChatSession | null>;
  deleteSession(id: string): Promise<boolean>;
}