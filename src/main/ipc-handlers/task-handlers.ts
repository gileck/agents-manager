import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import type { AppServices } from '../providers/setup';
import type {
  TaskCreateInput,
  TaskUpdateInput,
  TaskFilter,
  TaskEventFilter,
  ActivityFilter,
  DebugTimelineEntry,
} from '../../shared/types';

export function registerTaskHandlers(services: AppServices): void {
  // ============================================
  // Task Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_LIST, async (_, filter?: TaskFilter) => {
    return services.taskStore.listTasks(filter);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_GET, async (_, id: string) => {
    validateId(id);
    return services.taskStore.getTask(id);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_CREATE, async (_, input: TaskCreateInput) => {
    validateInput(input, ['projectId', 'pipelineId', 'title']);
    return services.workflowService.createTask(input);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_UPDATE, async (_, id: string, input: TaskUpdateInput) => {
    validateId(id);
    // Strip status to prevent bypassing pipeline transitions via direct update
    const { status: _status, ...safeInput } = input;
    return services.workflowService.updateTask(id, safeInput);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_DELETE, async (_, id: string) => {
    validateId(id);
    return services.workflowService.deleteTask(id);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_RESET, async (_, id: string, pipelineId?: string) => {
    validateId(id);
    if (pipelineId !== undefined) validateId(pipelineId, 'pipelineId');
    return services.workflowService.resetTask(id, pipelineId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_TRANSITION, async (_, taskId: string, toStatus: string, actor?: string) => {
    validateId(taskId);
    return services.workflowService.transitionTask(taskId, toStatus, actor);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_TRANSITIONS, async (_, taskId: string) => {
    validateId(taskId);
    const task = await services.taskStore.getTask(taskId);
    if (!task) return [];
    return services.pipelineEngine.getValidTransitions(task, 'manual');
  });

  registerIpcHandler(IPC_CHANNELS.TASK_DEPENDENCIES, async (_, taskId: string) => {
    validateId(taskId);
    return services.taskStore.getDependencies(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_DEPENDENTS, async (_, taskId: string) => {
    validateId(taskId);
    return services.taskStore.getDependents(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_ADD_DEPENDENCY, async (_, taskId: string, dependsOnTaskId: string) => {
    validateId(taskId);
    validateId(dependsOnTaskId);
    await services.taskStore.addDependency(taskId, dependsOnTaskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_REMOVE_DEPENDENCY, async (_, taskId: string, dependsOnTaskId: string) => {
    validateId(taskId);
    validateId(dependsOnTaskId);
    await services.taskStore.removeDependency(taskId, dependsOnTaskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_ALL_TRANSITIONS, async (_, taskId: string) => {
    validateId(taskId);
    const task = await services.taskStore.getTask(taskId);
    if (!task) return { manual: [], agent: [], system: [] };
    return services.pipelineEngine.getAllTransitions(task);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_FORCE_TRANSITION, async (_, taskId: string, toStatus: string, actor?: string) => {
    validateId(taskId);
    return services.workflowService.forceTransitionTask(taskId, toStatus, actor);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_GUARD_CHECK, async (_, taskId: string, toStatus: string, trigger: string) => {
    validateId(taskId);
    const task = await services.taskStore.getTask(taskId);
    if (!task) return null;
    return services.pipelineEngine.checkGuards(task, toStatus, trigger as 'manual' | 'agent' | 'system');
  });

  registerIpcHandler(IPC_CHANNELS.TASK_HOOK_RETRY, async (_, taskId: string, hookName: string, transitionFrom?: string, transitionTo?: string) => {
    validateId(taskId);
    return services.pipelineInspectionService.retryHook(taskId, hookName, transitionFrom, transitionTo);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_PIPELINE_DIAGNOSTICS, async (_, taskId: string) => {
    validateId(taskId);
    return services.pipelineInspectionService.getPipelineDiagnostics(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_ADVANCE_PHASE, async (_, taskId: string) => {
    validateId(taskId);
    return services.pipelineInspectionService.advancePhase(taskId);
  });

  // ============================================
  // Event Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.EVENT_LIST, async (_, filter?: TaskEventFilter) => {
    return services.taskEventLog.getEvents(filter);
  });

  // ============================================
  // Activity Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.ACTIVITY_LIST, async (_, filter?: ActivityFilter) => {
    return services.activityLog.getEntries(filter);
  });

  // ============================================
  // Prompt Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.PROMPT_LIST, async (_, taskId: string) => {
    validateId(taskId);
    return services.pendingPromptStore.getPendingForTask(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.PROMPT_RESPOND, async (_, promptId: string, response: Record<string, unknown>) => {
    validateId(promptId);
    return services.workflowService.respondToPrompt(promptId, response);
  });

  // ============================================
  // Artifact Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.ARTIFACT_LIST, async (_, taskId: string) => {
    validateId(taskId);
    return services.taskArtifactStore.getArtifactsForTask(taskId);
  });

  // ============================================
  // Task Context Entries
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_CONTEXT_ENTRIES, async (_, taskId: string) => {
    validateId(taskId);
    return services.taskContextStore.getEntriesForTask(taskId);
  });

  // ============================================
  // Debug Timeline
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_DEBUG_TIMELINE, async (_, taskId: string): Promise<DebugTimelineEntry[]> => {
    validateId(taskId);
    return services.timelineService.getTimeline(taskId);
  });

  // ============================================
  // Worktree
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_WORKTREE, async (_, taskId: string) => {
    validateId(taskId);
    const task = await services.taskStore.getTask(taskId);
    if (!task) return null;
    const project = await services.projectStore.getProject(task.projectId);
    if (!project?.path) return null;
    const wm = services.createWorktreeManager(project.path);
    return wm.get(taskId);
  });

  // ============================================
  // Workflow Review
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_WORKFLOW_REVIEW, async (_, taskId: string) => {
    validateId(taskId);
    return services.workflowService.startAgent(taskId, 'review', 'task-workflow-reviewer');
  });

  // ============================================
  // Dashboard Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.DASHBOARD_STATS, async () => {
    return services.workflowService.getDashboardStats();
  });
}
