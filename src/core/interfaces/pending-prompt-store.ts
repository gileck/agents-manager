import type { PendingPrompt, PendingPromptCreateInput } from '../../shared/types';

export interface IPendingPromptStore {
  createPrompt(input: PendingPromptCreateInput): Promise<PendingPrompt>;
  answerPrompt(id: string, response: Record<string, unknown>): Promise<PendingPrompt | null>;
  getPrompt(id: string): Promise<PendingPrompt | null>;
  getPendingForTask(taskId: string): Promise<PendingPrompt[]>;
  expirePromptsForRun(agentRunId: string): Promise<number>;
}
