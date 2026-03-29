import type { TerminalSession, TerminalCreateInput } from '../../shared/types';

export interface ITerminalStore {
  getTerminal(id: string): Promise<TerminalSession | null>;
  listTerminals(projectId?: string): Promise<TerminalSession[]>;
  createTerminal(input: TerminalCreateInput & { id?: string; claudeSessionId?: string }): Promise<TerminalSession>;
  updateClaudeSessionId(id: string, claudeSessionId: string): Promise<void>;
  deleteTerminal(id: string): Promise<boolean>;
}
