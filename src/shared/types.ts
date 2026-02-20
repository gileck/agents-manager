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
  bugPipelineId: string | null;
  themeConfig: string | null;
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
}

export interface HookFailure {
  hook: string;
  error: string;
  policy: HookExecutionPolicy;
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

// Plan comment types
export interface PlanComment {
  author: string;
  content: string;
  createdAt: number;
}

// Task types
export interface Task {
  id: string;
  projectId: string;
  pipelineId: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  tags: string[];
  parentTaskId: string | null;
  featureId: string | null;
  domain: string | null;
  assignee: string | null;
  prLink: string | null;
  branchName: string | null;
  plan: string | null;
  subtasks: Subtask[];
  planComments: PlanComment[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface TaskCreateInput {
  projectId: string;
  pipelineId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  tags?: string[];
  parentTaskId?: string;
  featureId?: string;
  domain?: string;
  assignee?: string;
  prLink?: string;
  branchName?: string;
  subtasks?: Subtask[];
  metadata?: Record<string, unknown>;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  tags?: string[];
  parentTaskId?: string | null;
  featureId?: string | null;
  domain?: string | null;
  assignee?: string | null;
  prLink?: string | null;
  branchName?: string | null;
  plan?: string | null;
  subtasks?: Subtask[];
  planComments?: PlanComment[];
  metadata?: Record<string, unknown>;
}

export interface TaskFilter {
  projectId?: string;
  pipelineId?: string;
  status?: string;
  priority?: number;
  assignee?: string;
  parentTaskId?: string | null;
  featureId?: string | null;
  domain?: string;
  tag?: string;
  /** Free-text search across title and description (case-insensitive substring match) */
  search?: string;
}

// Task dependency
export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
}

// Task event types
export type TaskEventCategory = 'status_change' | 'field_update' | 'dependency_change' | 'comment' | 'system' | 'agent' | 'agent_debug' | 'git' | 'github' | 'worktree';
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
export type AgentMode = 'plan' | 'implement' | 'review' | 'request_changes' | 'plan_revision' | 'investigate' | 'resolve_conflicts';

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
  prompt: string | null;
}

export interface AgentRunCreateInput {
  taskId: string;
  agentType: string;
  mode: AgentMode;
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
  prompt?: string;
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

export type PhaseType = 'plan' | 'implement' | 'review';
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
}

export interface TaskContextEntryCreateInput {
  taskId: string;
  agentRunId?: string;
  source: string;
  entryType: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface AgentContext {
  task: Task;
  project: Project;
  workdir: string;
  mode: AgentMode;
  taskContext?: TaskContextEntry[];
  validationErrors?: string;
  resolvedPrompt?: string;
  modeConfig?: AgentModeConfig;
}

export interface AgentConfig {
  model?: string;
  timeout?: number;
  maxTokens?: number;
  systemPrompt?: string;
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
  prompt?: string;
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
}

export interface AgentDefinitionUpdateInput {
  name?: string;
  description?: string;
  engine?: string;
  model?: string | null;
  modes?: AgentModeConfig[];
  systemPrompt?: string | null;
  timeout?: number | null;
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

export interface Notification {
  taskId: string;
  title: string;
  body: string;
  channel: string;
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
