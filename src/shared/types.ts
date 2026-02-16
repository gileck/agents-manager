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

// Settings types
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
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
export interface PipelineStatus {
  name: string;
  label: string;
  color?: string;
  isFinal?: boolean;
}

export type TransitionTrigger = 'manual' | 'automatic' | 'agent';

export interface TransitionGuard {
  name: string;
  params?: Record<string, unknown>;
}

export interface TransitionHook {
  name: string;
  params?: Record<string, unknown>;
}

export interface Transition {
  from: string;
  to: string;
  trigger: TransitionTrigger;
  guards?: TransitionGuard[];
  hooks?: TransitionHook[];
  label?: string;
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
  assignee: string | null;
  prLink: string | null;
  branchName: string | null;
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
  assignee?: string;
  prLink?: string;
  branchName?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  tags?: string[];
  parentTaskId?: string | null;
  assignee?: string | null;
  prLink?: string | null;
  branchName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TaskFilter {
  projectId?: string;
  pipelineId?: string;
  status?: string;
  priority?: number;
  assignee?: string;
  parentTaskId?: string | null;
  tag?: string;
}

// Task dependency
export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
}

// Task event types
export type TaskEventCategory = 'status_change' | 'field_update' | 'dependency_change' | 'comment' | 'system';
export type TaskEventSeverity = 'info' | 'warning' | 'error';

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
export type ActivityAction = 'create' | 'update' | 'delete' | 'transition' | 'system';
export type ActivityEntity = 'project' | 'task' | 'pipeline' | 'system';

export interface ActivityEntry {
  id: string;
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface ActivityCreateInput {
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface ActivityFilter {
  action?: ActivityAction;
  entityType?: ActivityEntity;
  entityId?: string;
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

export type GuardFn = (task: Task, transition: Transition, context: TransitionContext, db: unknown) => GuardResult;
export type HookFn = (task: Task, transition: Transition, context: TransitionContext) => Promise<void>;
