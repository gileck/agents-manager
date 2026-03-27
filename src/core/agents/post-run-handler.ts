import type { AgentRunResult, RevisionReason } from '../../shared/types';
import type { ITaskAPI } from '../interfaces/task-api';

/**
 * Callback types used by post-run handlers for logging.
 */
export type OnLog = (message: string) => void;
export type OnPostLog = (message: string, details?: Record<string, unknown>, durationMs?: number) => void;

/**
 * PostRunHandler — per-agent function that maps LLM structured output to TaskAPI calls.
 *
 * Each agent type has one handler colocated with its prompt builder.
 * The handler is called after a successful agent execution to persist results.
 *
 * This replaces the centralized PostRunExtractor by making each agent's handler
 * the authority on how its structured output maps to persistence operations.
 */
export type PostRunHandler = (
  taskApi: ITaskAPI,
  result: AgentRunResult,
  agentRunId: string | undefined,
  revisionReason: RevisionReason | undefined,
  onLog: OnLog,
  onPostLog?: OnPostLog,
) => Promise<void>;
