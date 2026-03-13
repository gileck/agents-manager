import type {
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskContextEntry,
  TransitionResult,
  AgentRun,
  AgentMode,
  RevisionReason,
  PendingPrompt,
  DashboardStats,
  AgentChatMessage,
} from '../../shared/types';

export interface IWorkflowService {
  createTask(input: TaskCreateInput): Promise<Task>;
  updateTask(id: string, input: TaskUpdateInput): Promise<Task | null>;
  deleteTask(id: string): Promise<boolean>;
  resetTask(id: string, pipelineId?: string): Promise<Task | null>;
  transitionTask(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult>;
  forceTransitionTask(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult>;
  startAgent(taskId: string, mode: AgentMode, agentType: string, revisionReason?: RevisionReason, onOutput?: (chunk: string) => void, onMessage?: (msg: AgentChatMessage) => void, onStatusChange?: (status: string) => void): Promise<AgentRun>;
  resumeAgent(taskId: string, message: string, callbacks: { onOutput?: (chunk: string) => void; onMessage?: (msg: AgentChatMessage) => void; onStatusChange?: (status: string) => void }): Promise<AgentRun | null>;
  stopAgent(runId: string): Promise<void>;
  respondToPrompt(promptId: string, response: Record<string, unknown>): Promise<PendingPrompt | null>;
  mergePR(taskId: string): Promise<TransitionResult>;
  getDashboardStats(now?: number): Promise<DashboardStats>;
  addContextEntry(taskId: string, input: { source: string; entryType: string; summary: string; data?: Record<string, unknown> }): Promise<TaskContextEntry>;
  addTaskFeedback(taskId: string, entryType: string, content: string, source?: string, agentRunId?: string): Promise<TaskContextEntry>;
  computeRunDiagnostics(runId: string): Promise<AgentRun>;
}
