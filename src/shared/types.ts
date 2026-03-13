// Item types
export interface Item {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ItemCreateInput = {
  name: string;
  description?: string;
};

export type ItemUpdateInput = Partial<ItemCreateInput>;

// Theme types
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  border: string;
  input: string;
  ring: string;
}

export interface ThemeConfig {
  name: string;
  colors: ThemeColors;
  darkColors: ThemeColors;
  radius: string;
}

// Settings types
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  currentProjectId: string | null;
  defaultPipelineId: string | null;
  themeConfig: string | null;
  chatDefaultAgentLib: string | null;
}

// Log types (kept for template infrastructure)
export interface LogEntry {
  id: string;
  runId: string;
  timestamp: string;
  level: string;
  message: string;
}

// ============================================
// Phase 1: Domain Types
// ============================================

// User types
export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  updatedAt: number;
}

// Pipeline types
export type StatusCategory = 'ready' | 'agent_running' | 'human_review' | 'waiting_for_input' | 'terminal';

export interface PipelineStatus {
  name: string;
  label: string;
  color?: string;
  isFinal?: boolean;
  category?: StatusCategory;
  position?: number;
}

export type TransitionTrigger = 'manual' | 'agent' | 'system';

export interface TransitionGuard {
  name: string;
  params?: Record<string, unknown>;
}

export type HookExecutionPolicy = 'required' | 'best_effort' | 'fire_and_forget';

export interface HookResult {
  success: boolean;
  error?: string;
  followUpTransition?: { to: string; trigger: TransitionTrigger };
}

export interface HookFailure {
  hook: string;
  error: string;
  policy: HookExecutionPolicy;
  followUpTransition?: { to: string; trigger: TransitionTrigger };
}

export interface TransitionHook {
  name: string;
  params?: Record<string, unknown>;
  policy?: HookExecutionPolicy;
}

export interface Transition {
  from: string;
  to: string;
  trigger: TransitionTrigger;
  guards?: TransitionGuard[];
  hooks?: TransitionHook[];
  label?: string;
  agentOutcome?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  statuses: PipelineStatus[];
  transitions: Transition[];
  taskType: string;
  createdAt: number;
  updatedAt: number;
}

export interface PipelineCreateInput {
  name: string;
  description?: string;
  statuses: PipelineStatus[];
  transitions: Transition[];
  taskType: string;
}

export interface PipelineUpdateInput {
  name?: string;
  description?: string;
  statuses?: PipelineStatus[];
  transitions?: Transition[];
  taskType?: string;
}

// Project types
export interface Project {
  id: string;
  name: string;
  description: string | null;
  path: string | null;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  path?: string;
  config?: Record<string, unknown>;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  path?: string;
  config?: Record<string, unknown>;
}

// Feature types

/**
 * Computed feature status derived from the aggregate progress of its tasks.
 * Not persisted in the database — calculated on the fly and used only in
 * {@link FeatureWithProgress} for display purposes.
 */
export type FeatureStatus = 'open' | 'in_progress' | 'done';

export interface Feature {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FeatureCreateInput {
  projectId: string;
  title: string;
  description?: string;
}

export interface FeatureUpdateInput {
  title?: string;
  description?: string;
}

export interface FeatureFilter {
  projectId?: string;
}

export interface FeatureWithProgress extends Feature {
  status: FeatureStatus;
  totalTasks: number;
  doneTasks: number;
}

// Subtask types
export type SubtaskStatus = 'open' | 'in_progress' | 'done';

export interface Subtask {
  name: string;
  status: SubtaskStatus;
}

// Implementation phase types (for multi-phase tasks)
export type ImplementationPhaseStatus = 'pending' | 'in_progress' | 'completed';

export interface ImplementationPhase {
  id: string;           // "phase-1", "phase-2", etc.
  name: string;         // "Phase 1: Data Model & Migration"
  status: ImplementationPhaseStatus;
  subtasks: Subtask[];
  prLink?: string;      // PR URL for this phase (set after merge)
}

/**
 * @deprecated Use TaskContextEntry with FEEDBACK_ENTRY_TYPES instead.
 * Retained for backward compatibility with JSON blob columns.
 */
export interface PlanComment {
  author: string;
  content: string;
  createdAt: number;
  addressed?: boolean;
}

// Task types
export const VALID_TASK_TYPES = ['bug', 'feature', 'improvement'] as const;
export type TaskType = typeof VALID_TASK_TYPES[number];

export const VALID_TASK_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
export type TaskSize = typeof VALID_TASK_SIZES[number];

export const VALID_TASK_COMPLEXITIES = ['low', 'medium', 'high'] as const;
export type TaskComplexity = typeof VALID_TASK_COMPLEXITIES[number];

export type TaskCreatedBy = 'user' | 'workflow-reviewer' | 'session-agent';

export interface Task {
  id: string;
  projectId: string;
  pipelineId: string;
  title: string;
  description: string | null;
  type: TaskType;
  size: TaskSize | null;
  complexity: TaskComplexity | null;
  status: string;
  priority: number;
  tags: string[];
  parentTaskId: string | null;
  featureId: string | null;
  assignee: string | null;
  prLink: string | null;
  branchName: string | null;
  plan: string | null;
  technicalDesign: string | null;
  debugInfo: string | null;
  subtasks: Subtask[];
  phases: ImplementationPhase[] | null;
  /** @deprecated Use TaskContextEntry with entryType='plan_feedback' instead. */
  planComments: PlanComment[];
  /** @deprecated Use TaskContextEntry with entryType='design_feedback' instead. */
  technicalDesignComments: PlanComment[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  createdBy: TaskCreatedBy | null;
}

export interface TaskCreateInput {
  projectId: string;
  pipelineId: string;
  title: string;
  description?: string;
  type?: TaskType;
  size?: TaskSize;
  complexity?: TaskComplexity;
  status?: string;
  priority?: number;
  tags?: string[];
  parentTaskId?: string;
  featureId?: string;
  assignee?: string;
  prLink?: string;
  branchName?: string;
  debugInfo?: string;
  subtasks?: Subtask[];
  phases?: ImplementationPhase[] | null;
  metadata?: Record<string, unknown>;
  createdBy?: TaskCreatedBy;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  type?: TaskType;
  size?: TaskSize | null;
  complexity?: TaskComplexity | null;
  status?: string;
  priority?: number;
  tags?: string[];
  parentTaskId?: string | null;
  featureId?: string | null;
  assignee?: string | null;
  prLink?: string | null;
  branchName?: string | null;
  plan?: string | null;
  technicalDesign?: string | null;
  debugInfo?: string | null;
  subtasks?: Subtask[];
  phases?: ImplementationPhase[] | null;
  /** @deprecated Use addTaskFeedback API with entryType='plan_feedback' instead. */
  planComments?: PlanComment[];
  /** @deprecated Use addTaskFeedback API with entryType='design_feedback' instead. */
  technicalDesignComments?: PlanComment[];
  metadata?: Record<string, unknown>;
  pipelineId?: string;
}

export interface TaskFilter {
  projectId?: string;
  pipelineId?: string;
  status?: string;
  type?: TaskType;
  size?: TaskSize;
  complexity?: TaskComplexity;
  priority?: number;
  assignee?: string;
  parentTaskId?: string | null;
  featureId?: string | null;
  tag?: string;
  /** Free-text search across title and description (case-insensitive substring match) */
  search?: string;
  createdBy?: TaskCreatedBy;
}

// Task dependency
export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
}

// Task event types
export type TaskEventCategory = 'status_change' | 'field_update' | 'dependency_change' | 'comment' | 'system' | 'agent' | 'agent_debug' | 'git' | 'github' | 'worktree' | 'hook_execution';
export type TaskEventSeverity = 'debug' | 'info' | 'warning' | 'error';

export interface TaskEvent {
  id: string;
  taskId: string;
  category: TaskEventCategory;
  severity: TaskEventSeverity;
  message: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface TaskEventCreateInput {
  taskId: string;
  category: TaskEventCategory;
  severity?: TaskEventSeverity;
  message: string;
  data?: Record<string, unknown>;
}

export interface TaskEventFilter {
  taskId?: string;
  category?: TaskEventCategory;
  severity?: TaskEventSeverity;
  since?: number;
  until?: number;
  /** Maximum number of rows to return. Defaults to 5000. */
  limit?: number;
}

// Activity log types
export type ActivityAction = 'create' | 'update' | 'delete' | 'reset' | 'transition' | 'system' | 'agent_start' | 'agent_complete' | 'prompt_response';
export type ActivityEntity = 'project' | 'task' | 'pipeline' | 'system' | 'agent_run';

export interface ActivityEntry {
  id: string;
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string;
  projectId: string | null;
  summary: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface ActivityCreateInput {
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string;
  projectId?: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface ActivityFilter {
  action?: ActivityAction;
  entityType?: ActivityEntity;
  entityId?: string;
  projectId?: string;
  since?: number;
  until?: number;
  /** Maximum number of rows to return. Defaults to 5000. */
  limit?: number;
}

// Pipeline engine types
export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export interface TransitionContext {
  trigger: TransitionTrigger;
  actor?: string;
  data?: Record<string, unknown>;
}

export interface TransitionResult {
  success: boolean;
  task?: Task;
  error?: string;
  guardFailures?: Array<{ guard: string; reason: string }>;
  hookFailures?: HookFailure[];
}

export interface TransitionHistoryEntry {
  id: string;
  taskId: string;
  fromStatus: string;
  toStatus: string;
  trigger: TransitionTrigger;
  actor: string | null;
  guardResults: Record<string, GuardResult>;
  createdAt: number;
}

export type GuardFn = (task: Task, transition: Transition, context: TransitionContext, db: unknown, params?: Record<string, unknown>) => GuardResult;
export type HookFn = (task: Task, transition: Transition, context: TransitionContext, params?: Record<string, unknown>) => Promise<HookResult | void>;

// ============================================
// Phase 2: Agent Execution Types
// ============================================

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
export type AgentMode = 'new' | 'revision';
export type RevisionReason = 'changes_requested' | 'info_provided' | 'merge_failed';

export interface AgentRun {
  id: string;
  taskId: string;
  agentType: string;
  mode: AgentMode;
  status: AgentRunStatus;
  output: string | null;
  outcome: string | null;
  payload: Record<string, unknown>;
  exitCode: number | null;
  startedAt: number;
  completedAt: number | null;
  costInputTokens: number | null;
  costOutputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  totalCostUsd: number | null;
  prompt: string | null;
  error: string | null;
  timeoutMs: number | null;
  maxTurns: number | null;
  messageCount: number | null;
  messages: AgentChatMessage[] | null;
  automatedAgentId: string | null;
  model: string | null;
  engine: string | null;
  sessionId: string | null;
}

export interface AgentRunCreateInput {
  taskId: string;
  agentType: string;
  mode: AgentMode;
  automatedAgentId?: string;
}

export interface AgentRunUpdateInput {
  status?: AgentRunStatus;
  output?: string;
  outcome?: string;
  payload?: Record<string, unknown>;
  exitCode?: number;
  completedAt?: number;
  costInputTokens?: number;
  costOutputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalCostUsd?: number;
  prompt?: string;
  error?: string;
  timeoutMs?: number;
  maxTurns?: number;
  messageCount?: number;
  messages?: AgentChatMessage[];
  model?: string;
  engine?: string;
  sessionId?: string;
}

export type ArtifactType = 'branch' | 'pr' | 'commit' | 'diff' | 'document';

export interface TaskArtifact {
  id: string;
  taskId: string;
  type: ArtifactType;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface TaskArtifactCreateInput {
  taskId: string;
  type: ArtifactType;
  data?: Record<string, unknown>;
}

export type PhaseStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface TaskPhase {
  id: string;
  taskId: string;
  phase: string;
  status: PhaseStatus;
  agentRunId: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface TaskPhaseCreateInput {
  taskId: string;
  phase: string;
}

export interface TaskPhaseUpdateInput {
  status?: PhaseStatus;
  agentRunId?: string;
  startedAt?: number;
  completedAt?: number;
}

export type PromptType = 'needs_info' | 'options_proposed' | 'changes_requested';
export type PromptStatus = 'pending' | 'answered' | 'expired';

export interface PendingPrompt {
  id: string;
  taskId: string;
  agentRunId: string;
  promptType: string;
  payload: Record<string, unknown>;
  response: Record<string, unknown> | null;
  resumeOutcome: string | null;
  status: PromptStatus;
  createdAt: number;
  answeredAt: number | null;
}

export interface PendingPromptCreateInput {
  taskId: string;
  agentRunId: string;
  promptType: string;
  payload?: Record<string, unknown>;
  resumeOutcome?: string;
}

export interface TaskContextEntry {
  id: string;
  taskId: string;
  agentRunId: string | null;
  source: string;
  entryType: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: number;
  addressed: boolean;
  addressedByRunId: string | null;
}

export interface TaskContextEntryCreateInput {
  taskId: string;
  agentRunId?: string;
  source: string;
  entryType: string;
  summary: string;
  data?: Record<string, unknown>;
  addressed?: boolean;
}

export const FEEDBACK_ENTRY_TYPES = [
  'plan_feedback', 'design_feedback', 'implementation_feedback',
] as const;

export const TRIAGE_ENTRY_TYPE = 'triage_summary' as const;

export interface AgentContext {
  task: Task;
  project: Project;
  workdir: string;
  mode: AgentMode;
  revisionReason?: RevisionReason;
  taskContext?: TaskContextEntry[];
  validationErrors?: string;
  resolvedPrompt?: string;
  modeConfig?: AgentModeConfig;
  skills?: string[];
  customPrompt?: string;
  sessionId?: string;
  /** When true, the session should be resumed (not created fresh). Set by agent-service session management. */
  resumeSession?: boolean;
  /** When set, this run is resuming a previously interrupted run (crash/shutdown recovery). */
  resumedFromRunId?: string;
  /** URL of the dev server running in the task's worktree, if any. */
  devServerUrl?: string;
}

// ============================================
// Agent Chat Message Types (for agent run streaming UI)
// ============================================

export interface AgentChatMessageAssistantText {
  type: 'assistant_text';
  text: string;
  timestamp: number;
  /** Non-null when this message originates from a subagent (Task tool). */
  parentToolUseId?: string;
}

export interface AgentChatMessageToolUse {
  type: 'tool_use';
  toolName: string;
  toolId?: string;
  input: string;
  timestamp: number;
  /** Non-null when this message originates from a subagent (Task tool). */
  parentToolUseId?: string;
}

export interface AgentChatMessageToolResult {
  type: 'tool_result';
  toolId?: string;
  result: string;
  timestamp: number;
  /** Non-null when this message originates from a subagent (Task tool). */
  parentToolUseId?: string;
}

export interface AgentChatMessageUser {
  type: 'user';
  text: string;
  images?: ChatImageRef[];
  timestamp: number;
}

export interface AgentChatMessageStatus {
  type: 'status';
  status: AgentRunStatus;
  message: string;
  stack?: string;
  timestamp: number;
}

export interface AgentChatMessageUsage {
  type: 'usage';
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
  /** Input tokens from the last assistant message (input + cache_read + cache_creation) — actual context window utilization. */
  lastContextInputTokens?: number;
  timestamp: number;
}

export interface AgentChatMessageThinking {
  type: 'thinking';
  text: string;
  timestamp: number;
  /** Non-null when this message originates from a subagent (Task tool). */
  parentToolUseId?: string;
}

export interface AgentChatMessageRunInfo {
  type: 'agent_run_info';
  agentRunId: string;
  timestamp: number;
  agentType?: string;
  taskId?: string;
}

export interface AgentChatMessageCompactBoundary {
  type: 'compact_boundary';
  trigger: string;
  preTokens: number;
  timestamp: number;
}

export interface AgentChatMessageCompacting {
  type: 'compacting';
  active: boolean;
  timestamp: number;
}

export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestionItem {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskUserQuestionOption[];
}

export interface AgentChatMessageAskUserQuestion {
  type: 'ask_user_question';
  questionId: string;
  questions: AskUserQuestionItem[];
  answers?: Record<string, string>;
  answered: boolean;
  timestamp: number;
}

/** Partial streaming delta — text or thinking token being generated in real-time. */
export interface AgentChatMessageStreamDelta {
  type: 'stream_delta';
  deltaType: 'text_delta' | 'thinking_delta' | 'input_json_delta';
  delta: string;
  timestamp: number;
}

/** Permission request — sent to UI when a tool needs user approval before execution. */
export interface AgentChatMessagePermissionRequest {
  type: 'permission_request';
  requestId: string;
  toolName: string;
  toolInput: unknown;
  timestamp: number;
}

/** Permission response — sent from UI back to service to approve/deny a tool. */
export interface AgentChatMessagePermissionResponse {
  type: 'permission_response';
  requestId: string;
  allowed: boolean;
  timestamp: number;
}

/** Notification from the agent (e.g., progress updates, warnings). */
export interface AgentChatMessageNotification {
  type: 'notification';
  title?: string;
  body: string;
  timestamp: number;
}

/** Subagent lifecycle event — emitted when a subagent starts or completes. */
export interface AgentChatMessageSubagentActivity {
  type: 'subagent_activity';
  agentName: string;
  status: 'started' | 'completed';
  toolUseId?: string;
  result?: string;
  timestamp: number;
}

/** Slash command invocation — emitted when the user sends a /command. */
export interface AgentChatMessageSlashCommand {
  type: 'slash_command';
  command: string;
  args?: string;
  status: 'invoked' | 'completed';
  timestamp: number;
}

/** Category for post-processing log messages emitted after agent execution. */
export type PostProcessingLogCategory =
  | 'validation'
  | 'git'
  | 'pipeline'
  | 'extraction'
  | 'notification'
  | 'system';

/** Post-processing log — emitted during the post-agent pipeline for visibility. */
export interface AgentChatMessagePostProcessingLog {
  type: 'post_processing_log';
  category: PostProcessingLogCategory;
  message: string;
  details?: Record<string, unknown>;
  durationMs?: number;
  timestamp: number;
}

export type AgentChatMessage =
  | AgentChatMessageAssistantText
  | AgentChatMessageToolUse
  | AgentChatMessageToolResult
  | AgentChatMessageUser
  | AgentChatMessageStatus
  | AgentChatMessageUsage
  | AgentChatMessageThinking
  | AgentChatMessageRunInfo
  | AgentChatMessageCompactBoundary
  | AgentChatMessageCompacting
  | AgentChatMessageAskUserQuestion
  | AgentChatMessageStreamDelta
  | AgentChatMessagePermissionRequest
  | AgentChatMessagePermissionResponse
  | AgentChatMessageNotification
  | AgentChatMessageSubagentActivity
  | AgentChatMessageSlashCommand
  | AgentChatMessagePostProcessingLog;

export interface AgentConfig {
  model?: string;
  timeout?: number;
  maxTokens?: number;
  systemPrompt?: string;
  engine?: string;
}

export interface AgentRunResult {
  exitCode: number;
  output: string;
  outcome?: string;
  payload?: Record<string, unknown>;
  structuredOutput?: Record<string, unknown>;
  error?: string;
  costInputTokens?: number;
  costOutputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalCostUsd?: number;
  prompt?: string;
  model?: string;
  /** Why the process was killed: 'timeout', 'stopped', or 'external_signal'. */
  killReason?: string;
  /** Original OS exit code (e.g. 143 for SIGTERM, 137 for SIGKILL). */
  rawExitCode?: number;
}

export interface AgentInfo {
  type: string;
  name: string;
  description: string;
  available: boolean;
}

// Agent definition types
export interface AgentModeConfig {
  mode: string;
  promptTemplate: string;
  timeout?: number;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string | null;
  engine: string;
  model: string | null;
  modes: AgentModeConfig[];
  systemPrompt: string | null;
  timeout: number | null;
  skills: string[];
  isBuiltIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AgentDefinitionCreateInput {
  name: string;
  description?: string;
  engine: string;
  model?: string;
  modes?: AgentModeConfig[];
  systemPrompt?: string;
  timeout?: number;
  skills?: string[];
}

export interface AgentDefinitionUpdateInput {
  name?: string;
  description?: string;
  engine?: string;
  model?: string | null;
  modes?: AgentModeConfig[];
  systemPrompt?: string | null;
  timeout?: number | null;
  skills?: string[];
}

export interface Worktree {
  path: string;
  branch: string;
  taskId: string;
  locked: boolean;
}

export interface GitLogEntry {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitCommitDetail {
  hash: string;
  body: string;
  files: GitFileChange[];
}

export interface GitFileChange {
  status: string; // 'A' added, 'M' modified, 'D' deleted, etc.
  path: string;
}

export interface CreatePRParams {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface PRInfo {
  url: string;
  number: number;
  title: string;
}

export type PRStatus = 'open' | 'closed' | 'merged';

// PR Checks types
export type PRCheckState = 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'PENDING' | 'WAITING';
export type PRCheckConclusion = 'SUCCESS' | 'FAILURE' | 'NEUTRAL' | 'CANCELLED' | 'TIMED_OUT' | 'ACTION_REQUIRED' | 'SKIPPED' | 'STALE' | null;

export interface PRCheckRun {
  name: string;
  state: PRCheckState;
  conclusion: PRCheckConclusion;
  startedAt: string | null;
  completedAt: string | null;
}

export type PRMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
export type PRStateUpper = 'OPEN' | 'CLOSED' | 'MERGED';
export type PRMergeStateStatus = 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE';

export interface PRChecksResult {
  prNumber: number;
  prState: PRStateUpper;
  mergeable: PRMergeableState;
  mergeStateStatus: PRMergeStateStatus;
  checks: PRCheckRun[];
  fetchedAt: number;
}

export type NotificationAction =
  | { label: string; callbackData: string; url?: never }
  | { label: string; url: string; callbackData?: never };

export interface Notification {
  taskId: string;
  projectId?: string;
  title: string;
  body: string;
  channel: string;
  navigationUrl?: string;
  actions?: NotificationAction[];
}

export interface InAppNotification {
  id: string;
  taskId: string;
  projectId: string | null;
  title: string;
  body: string;
  navigationUrl: string;
  read: boolean;
  createdAt: number;
}

export interface InAppNotificationCreateInput {
  taskId: string;
  projectId?: string;
  title: string;
  body: string;
  navigationUrl: string;
}

export interface InAppNotificationFilter {
  projectId?: string;
  unreadOnly?: boolean;
  limit?: number;
}

export interface TelegramBotLogEntry {
  timestamp: number;
  direction: 'in' | 'out' | 'status';
  message: string;
}

// ============================================
// Pipeline Control & Diagnostics Types
// ============================================

export interface GuardCheckResult {
  canTransition: boolean;
  results: Array<{ guard: string; allowed: boolean; reason?: string }>;
}

export interface TransitionWithGuards extends Transition {
  guardStatus?: GuardCheckResult;
}

export interface AllTransitionsResult {
  manual: TransitionWithGuards[];
  agent: TransitionWithGuards[];
  system: TransitionWithGuards[];
}

export interface HookRetryResult {
  success: boolean;
  hookName: string;
  error?: string;
}

export interface HookFailureRecord {
  id: string;
  taskId: string;
  hookName: string;
  error: string;
  policy: HookExecutionPolicy;
  transitionFrom: string;
  transitionTo: string;
  timestamp: number;
  retryable: boolean;
}

export interface PipelineDiagnostics {
  taskId: string;
  currentStatus: string;
  statusMeta: {
    label: string;
    category?: StatusCategory;
    isFinal?: boolean;
    color?: string;
  };
  allTransitions: AllTransitionsResult;
  recentHookFailures: HookFailureRecord[];
  phases: ImplementationPhase[] | null;
  activePhaseIndex: number;
  agentState: {
    hasRunningAgent: boolean;
    lastRunStatus: AgentRunStatus | null;
    lastRunError: string | null;
    totalFailedRuns: number;
  };
  isStuck: boolean;
  stuckReason?: string;
}

// ============================================
// Phase 4: Dashboard Types
// ============================================

export interface DebugTimelineEntry {
  id?: string;
  timestamp: number;
  source: 'event' | 'activity' | 'transition' | 'agent' | 'phase' | 'artifact' | 'prompt' | 'git' | 'github' | 'worktree' | 'context';
  severity: 'info' | 'warning' | 'error' | 'debug';
  title: string;
  data?: Record<string, unknown>;
}

export interface DashboardStats {
  projectCount: number;
  totalTasks: number;
  tasksByStatus: Record<string, number>;
  activeAgentRuns: number;
  recentActivityCount: number;
}

// ============================================
// Chat Image Types
// ============================================

export type ChatImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ChatImage {
  mediaType: ChatImageMediaType;
  base64: string;
  name?: string;
}

export interface ChatImageRef {
  path: string;
  mediaType: ChatImageMediaType;
  name?: string;
}

// ============================================
// Chat Types
// ============================================

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  createdAt: number;
  costInputTokens: number | null;
  costOutputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  totalCostUsd: number | null;
  /** Input tokens from the last API call in this turn — represents actual context window usage. */
  lastContextInputTokens: number | null;
}

export interface ChatMessageCreateInput {
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  costInputTokens?: number;
  costOutputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalCostUsd?: number;
  lastContextInputTokens?: number;
}

// Chat scope type
export type ChatScopeType = 'project' | 'task';

// Chat session source
export type ChatSessionSource = 'desktop' | 'telegram' | 'cli' | 'agent-chat';

// Permission mode for agent-chat sessions
export type PermissionMode = 'read_only' | 'read_write' | 'full_access';


// Chat Session types
export interface ChatSession {
  id: string;
  projectId: string;
  scopeType: ChatScopeType;
  scopeId: string;
  name: string;
  agentLib: string | null;
  model: string | null;
  source: ChatSessionSource;
  agentRole: string | null;
  agentRunId: string | null;
  permissionMode: PermissionMode | null;
  sidebarHidden: boolean;
  /** Custom instructions appended to the system prompt for this session. */
  systemPromptAppend: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSessionWithDetails extends ChatSession {
  messageCount: number;
  taskTitle?: string;
}

export interface ChatSessionCreateInput {
  scopeType: ChatScopeType;
  scopeId: string;
  name: string;
  agentLib?: string;
  model?: string;
  source?: ChatSessionSource;
  agentRole?: string;
  permissionMode?: PermissionMode;
  /** The project this session belongs to. For project-scoped sessions this equals scopeId; for task-scoped sessions it is the task's projectId. */
  projectId: string;
}

// Chat agent event types (used by ChatAgentService consumers)
export type ChatAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'message'; message: AgentChatMessage }
  | { type: 'stream_delta'; delta: AgentChatMessageStreamDelta }
  | { type: 'permission_request'; request: AgentChatMessagePermissionRequest };

export interface ChatSendOptions {
  systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  onEvent?: (event: ChatAgentEvent) => void;
  images?: ChatImage[];
  pipelineSessionId?: string;
  resumeSession?: boolean;
  isAgentChat?: boolean;
  permissionMode?: PermissionMode | null;
}

export interface ChatSendResult {
  userMessage: ChatMessage;
  sessionId: string;
  completion: Promise<void>;
}

export interface ChatSessionUpdateInput {
  name?: string;
  agentLib?: string | null;
  model?: string | null;
  agentRunId?: string | null;
  permissionMode?: PermissionMode | null;
  systemPromptAppend?: string | null;
}

export interface TaskChatSessionWithTitle extends ChatSession {
  scopeType: 'task';
  taskTitle: string;
  taskStatus: string;
}

export interface RunningAgent {
  sessionId: string;
  sessionName: string;
  scopeType: ChatScopeType;
  scopeId: string;
  projectId: string;
  projectName: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  lastActivity: number;
  messagePreview?: string;
}

// ============================================
// Kanban Board Types
// ============================================

export interface KanbanBoardConfig {
  id: string;
  projectId: string;
  name: string;
  columns: KanbanColumn[];
  filters: KanbanFilters;
  sortBy: 'priority' | 'created' | 'updated' | 'manual';
  sortDirection: 'asc' | 'desc';
  cardHeight: 'compact' | 'normal' | 'expanded';
  showSubtasks: boolean;
  showAssignee: boolean;
  showTags: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface KanbanColumn {
  id: string;
  title: string;
  statuses: string[];
  color?: string;
  collapsed: boolean;
  order: number;
  wip?: number;
}

export interface KanbanFilters {
  pipelineId?: string;
  assignee?: string;
  tags?: string[];
  featureId?: string;
  search?: string;
}

export interface KanbanBoardCreateInput {
  projectId: string;
  name: string;
  columns?: KanbanColumn[];
}

export interface KanbanBoardUpdateInput {
  name?: string;
  columns?: KanbanColumn[];
  filters?: KanbanFilters;
  sortBy?: 'priority' | 'created' | 'updated' | 'manual';
  sortDirection?: 'asc' | 'desc';
  cardHeight?: 'compact' | 'normal' | 'expanded';
  showSubtasks?: boolean;
  showAssignee?: boolean;
  showTags?: boolean;
}

// ============================================
// App Debug Log Types
// ============================================

export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppDebugLogEntry {
  id: string;
  level: AppLogLevel;
  source: string;
  message: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface AppDebugLogCreateInput {
  level: AppLogLevel;
  source: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface AppDebugLogFilter {
  level?: AppLogLevel;
  source?: string;
  search?: string;
  since?: number;
  until?: number;
  /** Maximum number of rows to return. Defaults to 500. */
  limit?: number;
}

// ============================================
// Automated Agent Types
// ============================================

export type AutomatedAgentScheduleType = 'interval' | 'daily-at' | 'cron' | 'manual';

export interface AutomatedAgentSchedule {
  type: AutomatedAgentScheduleType;
  value: string; // interval: ms string, daily-at: "HH:MM", cron: expression, manual: ""
}

export interface AutomatedAgentCapabilities {
  canCreateTasks: boolean;
  canModifyTasks: boolean;
  readOnly: boolean;
  dryRun: boolean;
  maxActions: number;
}

export interface AutomatedAgent {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  promptInstructions: string;
  capabilities: AutomatedAgentCapabilities;
  schedule: AutomatedAgentSchedule;
  enabled: boolean;
  maxRunDurationMs: number;
  templateId: string | null;
  lastRunAt: number | null;
  lastRunStatus: string | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AutomatedAgentCreateInput {
  projectId: string;
  name: string;
  description?: string;
  promptInstructions: string;
  capabilities?: Partial<AutomatedAgentCapabilities>;
  schedule: AutomatedAgentSchedule;
  enabled?: boolean;
  maxRunDurationMs?: number;
  templateId?: string;
}

export interface AutomatedAgentUpdateInput {
  name?: string;
  description?: string;
  promptInstructions?: string;
  capabilities?: Partial<AutomatedAgentCapabilities>;
  schedule?: AutomatedAgentSchedule;
  enabled?: boolean;
  maxRunDurationMs?: number;
}

export interface AutomatedAgentTemplate {
  id: string;
  name: string;
  description: string;
  promptInstructions: string;
  defaultSchedule: AutomatedAgentSchedule;
  defaultCapabilities: AutomatedAgentCapabilities;
  defaultMaxRunDurationMs: number;
}

// ============================================
// Dev Server Types
// ============================================

export type DevServerStatus = 'starting' | 'ready' | 'stopped' | 'error';

export interface DevServerInfo {
  taskId: string;
  projectId: string;
  port: number;
  url: string;
  status: DevServerStatus;
  startedAt: number;
  pid: number | null;
  error?: string;
}

// ============================================
// Agent Subscription Notification Types
// ============================================

export interface AgentNotificationPayload {
  taskId: string;
  taskTitle: string;
  fromStatus: string;
  toStatus: string;
  outcome: string;
  agentType: string;
  agentRunId: string;
  summary?: string;
  autoNotify: boolean;
}
