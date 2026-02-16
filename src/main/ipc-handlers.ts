import { app } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import { sendToRenderer } from '@template/main/core/window';
import * as itemService from './services/item-service';
import { getSetting, setSetting } from '@template/main/services/settings-service';
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

    return {
      theme,
      notificationsEnabled,
    };
  });

  registerIpcHandler(IPC_CHANNELS.SETTINGS_UPDATE, async (_, updates: Partial<AppSettings>): Promise<AppSettings> => {
    if (updates.theme !== undefined) {
      setSetting('theme', updates.theme);
    }
    if (updates.notificationsEnabled !== undefined) {
      setSetting('notifications_enabled', updates.notificationsEnabled.toString());
    }

    // Return updated settings
    return {
      theme: getSetting('theme', 'system') as 'light' | 'dark' | 'system',
      notificationsEnabled: getSetting('notifications_enabled', 'true') === 'true',
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
    return services.workflowService.updateTask(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.TASK_DELETE, async (_, id: string) => {
    validateId(id);
    return services.workflowService.deleteTask(id);
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
  // Dashboard Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.DASHBOARD_STATS, async () => {
    return services.workflowService.getDashboardStats();
  });
}
