import type {
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TransitionResult,
  AgentRun,
  AgentMode,
  PendingPrompt,
  DashboardStats,
} from '../../shared/types';

export interface IWorkflowService {
  createTask(input: TaskCreateInput): Promise<Task>;
  updateTask(id: string, input: TaskUpdateInput): Promise<Task | null>;
  deleteTask(id: string): Promise<boolean>;
  transitionTask(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult>;
  startAgent(taskId: string, mode: AgentMode, agentType?: string): Promise<AgentRun>;
  stopAgent(runId: string): Promise<void>;
  respondToPrompt(promptId: string, response: Record<string, unknown>): Promise<PendingPrompt | null>;
  mergePR(taskId: string): Promise<void>;
  getDashboardStats(): Promise<DashboardStats>;
}
