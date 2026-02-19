import { app } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import { sendToRenderer } from '@template/main/core/window';
import * as itemService from './services/item-service';
import { getSetting, setSetting } from '@template/main/services/settings-service';
import { LocalGitOps } from './services/local-git-ops';
import type { AppServices } from './providers/setup';
import type {
  ItemCreateInput,
  ItemUpdateInput,
  AppSettings,
  ProjectCreateInput,
  ProjectUpdateInput,
  TaskCreateInput,
  TaskUpdateInput,
  TaskFilter,
  TaskEventFilter,
  ActivityFilter,
  AgentMode,
  DebugTimelineEntry,
  FeatureCreateInput,
  FeatureUpdateInput,
  FeatureFilter,
  AgentDefinitionCreateInput,
  AgentDefinitionUpdateInput,
} from '../shared/types';

export function registerIpcHandlers(services: AppServices): void {
  // ============================================
  // Item Operations (template)
  // ============================================

  registerIpcHandler(IPC_CHANNELS.ITEM_LIST, async () => {
    return itemService.listItems();
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_GET, async (_, id: string) => {
    validateId(id);
    return itemService.getItem(id);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_CREATE, async (_, input: ItemCreateInput) => {
    validateInput(input, ['name']);
    return itemService.createItem(input);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_UPDATE, async (_, id: string, input: ItemUpdateInput) => {
    validateId(id);
    return itemService.updateItem(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_DELETE, async (_, id: string) => {
    validateId(id);
    return itemService.deleteItem(id);
  });

  // ============================================
  // Settings Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.SETTINGS_GET, async (): Promise<AppSettings> => {
    const theme = getSetting('theme', 'system') as 'light' | 'dark' | 'system';
    const notificationsEnabled = getSetting('notifications_enabled', 'true') === 'true';
    const currentProjectId = getSetting('current_project_id', '') || null;
    const defaultPipelineId = getSetting('default_pipeline_id', '') || null;
    const bugPipelineId = getSetting('bug_pipeline_id', '') || null;

    return {
      theme,
      notificationsEnabled,
      currentProjectId,
      defaultPipelineId,
      bugPipelineId,
    };
  });

  registerIpcHandler(IPC_CHANNELS.SETTINGS_UPDATE, async (_, updates: Partial<AppSettings>): Promise<AppSettings> => {
    if (updates.theme !== undefined) {
      setSetting('theme', updates.theme);
    }
    if (updates.notificationsEnabled !== undefined) {
      setSetting('notifications_enabled', updates.notificationsEnabled.toString());
    }
    if (updates.currentProjectId !== undefined) {
      setSetting('current_project_id', updates.currentProjectId ?? '');
    }
    if (updates.defaultPipelineId !== undefined) {
      setSetting('default_pipeline_id', updates.defaultPipelineId ?? '');
    }
    if (updates.bugPipelineId !== undefined) {
      setSetting('bug_pipeline_id', updates.bugPipelineId ?? '');
    }

    // Return updated settings
    return {
      theme: getSetting('theme', 'system') as 'light' | 'dark' | 'system',
      notificationsEnabled: getSetting('notifications_enabled', 'true') === 'true',
      currentProjectId: getSetting('current_project_id', '') || null,
      defaultPipelineId: getSetting('default_pipeline_id', '') || null,
      bugPipelineId: getSetting('bug_pipeline_id', '') || null,
    };
  });

  // ============================================
  // App Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.APP_GET_VERSION, async () => {
    return app.getVersion();
  });

  // ============================================
  // Project Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.PROJECT_LIST, async () => {
    return services.projectStore.listProjects();
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_GET, async (_, id: string) => {
    validateId(id);
    return services.projectStore.getProject(id);
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_CREATE, async (_, input: ProjectCreateInput) => {
    validateInput(input, ['name']);
    return services.projectStore.createProject(input);
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_UPDATE, async (_, id: string, input: ProjectUpdateInput) => {
    validateId(id);
    return services.projectStore.updateProject(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_DELETE, async (_, id: string) => {
    validateId(id);
    return services.projectStore.deleteProject(id);
  });

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

  registerIpcHandler(IPC_CHANNELS.TASK_RESET, async (_, id: string) => {
    validateId(id);
    return services.workflowService.resetTask(id);
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

  // ============================================
  // Pipeline Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.PIPELINE_LIST, async () => {
    return services.pipelineStore.listPipelines();
  });

  registerIpcHandler(IPC_CHANNELS.PIPELINE_GET, async (_, id: string) => {
    validateId(id);
    return services.pipelineStore.getPipeline(id);
  });

  // ============================================
  // Agent Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.AGENT_START, async (_, taskId: string, mode: AgentMode, agentType?: string) => {
    validateId(taskId);
    return services.workflowService.startAgent(taskId, mode, agentType, (chunk) => {
      sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, chunk);
    });
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_STOP, async (_, runId: string) => {
    validateId(runId);
    return services.workflowService.stopAgent(runId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_RUNS, async (_, taskId: string) => {
    validateId(taskId);
    return services.agentRunStore.getRunsForTask(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_GET, async (_, runId: string) => {
    validateId(runId);
    return services.agentRunStore.getRun(runId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_ACTIVE_TASK_IDS, async () => {
    const runs = await services.agentRunStore.getActiveRuns();
    return [...new Set(runs.map((r) => r.taskId))];
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_ACTIVE_RUNS, async () => {
    return services.agentRunStore.getActiveRuns();
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
  // Feature Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.FEATURE_LIST, async (_, filter?: FeatureFilter) => {
    return services.featureStore.listFeatures(filter);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_GET, async (_, id: string) => {
    validateId(id);
    return services.featureStore.getFeature(id);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_CREATE, async (_, input: FeatureCreateInput) => {
    validateInput(input, ['projectId', 'title']);
    return services.featureStore.createFeature(input);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_UPDATE, async (_, id: string, input: FeatureUpdateInput) => {
    validateId(id);
    return services.featureStore.updateFeature(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_DELETE, async (_, id: string) => {
    validateId(id);
    return services.featureStore.deleteFeature(id);
  });

  // ============================================
  // Agent Definition Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_LIST, async () => {
    return services.agentDefinitionStore.listDefinitions();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_GET, async (_, id: string) => {
    validateId(id);
    return services.agentDefinitionStore.getDefinition(id);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_CREATE, async (_, input: AgentDefinitionCreateInput) => {
    validateInput(input, ['name', 'engine']);
    return services.agentDefinitionStore.createDefinition(input);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_UPDATE, async (_, id: string, input: AgentDefinitionUpdateInput) => {
    validateId(id);
    return services.agentDefinitionStore.updateDefinition(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_DEF_DELETE, async (_, id: string) => {
    validateId(id);
    return services.agentDefinitionStore.deleteDefinition(id);
  });

  // ============================================
  // Git Operations
  // ============================================

  async function getTaskGitOps(taskId: string): Promise<LocalGitOps | null> {
    const task = await services.taskStore.getTask(taskId);
    if (!task) return null;
    const project = await services.projectStore.getProject(task.projectId);
    if (!project?.path) return null;
    const wm = services.createWorktreeManager(project.path);
    const worktree = await wm.get(taskId);
    if (!worktree) return null;
    return new LocalGitOps(worktree.path);
  }

  registerIpcHandler(IPC_CHANNELS.GIT_DIFF, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.diff('origin/main');
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_STAT, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.diffStat('origin/main');
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_WORKING_DIFF, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.diff('HEAD');
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_STATUS, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.status();
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_RESET_FILE, async (_, taskId: string, filepath: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(taskId);
    if (!gitOps) throw new Error('No worktree for task');
    await gitOps.resetFile(filepath);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_CLEAN, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(taskId);
    if (!gitOps) throw new Error('No worktree for task');
    await gitOps.clean();
  });

  registerIpcHandler(IPC_CHANNELS.GIT_PULL, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(taskId);
    if (!gitOps) throw new Error('No worktree for task');
    const branch = await gitOps.getCurrentBranch();
    await gitOps.pull(branch);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_LOG, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.log();
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_SHOW, async (_, taskId: string, hash: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.showCommit(hash);
    } catch {
      return null;
    }
  });

  // ============================================
  // Dashboard Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.DASHBOARD_STATS, async () => {
    return services.workflowService.getDashboardStats();
  });
}
