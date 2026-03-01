import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type {
  TaskFilter,
  TaskEventFilter,
  ActivityFilter,
} from '../../shared/types';

export function registerTaskHandlers(api: ApiClient): void {
  // ============================================
  // Task Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_LIST, async (_, filter?: TaskFilter) => {
    return api.tasks.list(filter);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_GET, async (_, id: string) => {
    return api.tasks.get(id);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_CREATE, async (_, input: unknown) => {
    return api.tasks.create(input as Parameters<typeof api.tasks.create>[0]);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_UPDATE, async (_, id: string, input: unknown) => {
    return api.tasks.update(id, input as Parameters<typeof api.tasks.update>[1]);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_DELETE, async (_, id: string) => {
    return api.tasks.delete(id);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_RESET, async (_, id: string, pipelineId?: string) => {
    return api.tasks.reset(id, pipelineId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_TRANSITION, async (_, taskId: string, toStatus: string, actor?: string) => {
    return api.tasks.transition(taskId, toStatus, actor);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_TRANSITIONS, async (_, taskId: string) => {
    return api.tasks.getTransitions(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_DEPENDENCIES, async (_, taskId: string) => {
    return api.tasks.getDependencies(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_DEPENDENTS, async (_, taskId: string) => {
    return api.tasks.getDependents(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_ADD_DEPENDENCY, async (_, taskId: string, dependsOnTaskId: string) => {
    return api.tasks.addDependency(taskId, dependsOnTaskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_REMOVE_DEPENDENCY, async (_, taskId: string, dependsOnTaskId: string) => {
    return api.tasks.removeDependency(taskId, dependsOnTaskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_ALL_TRANSITIONS, async (_, taskId: string) => {
    return api.tasks.getAllTransitions(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_FORCE_TRANSITION, async (_, taskId: string, toStatus: string, actor?: string) => {
    return api.tasks.forceTransition(taskId, toStatus, actor);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_GUARD_CHECK, async (_, taskId: string, toStatus: string, trigger: string) => {
    return api.tasks.guardCheck(taskId, toStatus, trigger);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_HOOK_RETRY, async (_, taskId: string, hookName: string, transitionFrom?: string, transitionTo?: string) => {
    return api.tasks.retryHook(taskId, hookName, transitionFrom, transitionTo);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_PIPELINE_DIAGNOSTICS, async (_, taskId: string) => {
    return api.tasks.getPipelineDiagnostics(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_ADVANCE_PHASE, async (_, taskId: string) => {
    return api.tasks.advancePhase(taskId);
  });

  // ============================================
  // Event Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.EVENT_LIST, async (_, filter?: TaskEventFilter) => {
    return api.events.list(filter);
  });

  // ============================================
  // Activity Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.ACTIVITY_LIST, async (_, filter?: ActivityFilter) => {
    return api.events.listActivities(filter);
  });

  // ============================================
  // Prompt Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.PROMPT_LIST, async (_, taskId: string) => {
    return api.tasks.getPrompts(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.PROMPT_RESPOND, async (_, promptId: string, response: Record<string, unknown>) => {
    return api.prompts.respond(promptId, response);
  });

  // ============================================
  // Artifact Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.ARTIFACT_LIST, async (_, taskId: string) => {
    return api.tasks.getArtifacts(taskId);
  });

  // ============================================
  // Task Context Entries
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_CONTEXT_ENTRIES, async (_, taskId: string) => {
    return api.tasks.getContext(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_ADD_CONTEXT_ENTRY, async (_, taskId: string, input: { source: string; entryType: string; summary: string; data?: Record<string, unknown> }) => {
    return api.tasks.addContext(taskId, input);
  });

  // ============================================
  // Debug Timeline
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_DEBUG_TIMELINE, async (_, taskId: string) => {
    return api.tasks.getTimeline(taskId);
  });

  // ============================================
  // Worktree
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_WORKTREE, async (_, taskId: string) => {
    return api.tasks.getWorktree(taskId);
  });

  // ============================================
  // Workflow Review
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_WORKFLOW_REVIEW, async (_, taskId: string) => {
    return api.agents.workflowReview(taskId);
  });

  // ============================================
  // Dashboard Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.DASHBOARD_STATS, async () => {
    return api.dashboard.getStats();
  });
}
