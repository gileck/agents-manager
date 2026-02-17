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
  DebugTimelineEntry,
} from '../shared/types';

function safeParse(json: string | null | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { return undefined; }
}

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

    return {
      theme,
      notificationsEnabled,
      currentProjectId,
      defaultPipelineId,
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

    // Return updated settings
    return {
      theme: getSetting('theme', 'system') as 'light' | 'dark' | 'system',
      notificationsEnabled: getSetting('notifications_enabled', 'true') === 'true',
      currentProjectId: getSetting('current_project_id', '') || null,
      defaultPipelineId: getSetting('default_pipeline_id', '') || null,
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

  registerIpcHandler(IPC_CHANNELS.AGENT_ACTIVE_TASK_IDS, async () => {
    const runs = await services.agentRunStore.getActiveRuns();
    return [...new Set(runs.map((r) => r.taskId))];
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
  // Debug Timeline
  // ============================================

  registerIpcHandler(IPC_CHANNELS.TASK_DEBUG_TIMELINE, async (_, taskId: string): Promise<DebugTimelineEntry[]> => {
    validateId(taskId);
    const db = services.db;
    const entries: DebugTimelineEntry[] = [];

    // 1. Events
    const eventRows = db.prepare(
      'SELECT category, severity, message, data, created_at FROM task_events WHERE task_id = ?'
    ).all(taskId) as { category: string; severity: string; message: string; data: string; created_at: number }[];
    for (const r of eventRows) {
      entries.push({
        timestamp: r.created_at,
        source: 'event',
        severity: (r.severity as DebugTimelineEntry['severity']) || 'info',
        title: r.message,
        data: { category: r.category, ...safeParse(r.data) },
      });
    }

    // 2. Activity log
    const activityRows = db.prepare(
      'SELECT summary, data, created_at FROM activity_log WHERE entity_id = ?'
    ).all(taskId) as { summary: string; data: string; created_at: number }[];
    for (const r of activityRows) {
      entries.push({
        timestamp: r.created_at,
        source: 'activity',
        severity: 'info',
        title: r.summary,
        data: safeParse(r.data),
      });
    }

    // 3. Transition history
    const transRows = db.prepare(
      'SELECT from_status, to_status, trigger, guard_results, created_at FROM transition_history WHERE task_id = ?'
    ).all(taskId) as { from_status: string; to_status: string; trigger: string; guard_results: string; created_at: number }[];
    for (const r of transRows) {
      entries.push({
        timestamp: r.created_at,
        source: 'transition',
        severity: 'info',
        title: `${r.from_status} → ${r.to_status} (${r.trigger})`,
        data: { guardResults: safeParse(r.guard_results) },
      });
    }

    // 4. Agent runs
    const agentRows = db.prepare(
      'SELECT mode, agent_type, status, exit_code, outcome, cost_input_tokens, cost_output_tokens, started_at FROM agent_runs WHERE task_id = ?'
    ).all(taskId) as { mode: string; agent_type: string; status: string; exit_code: number | null; outcome: string | null; cost_input_tokens: number | null; cost_output_tokens: number | null; started_at: number }[];
    for (const r of agentRows) {
      entries.push({
        timestamp: r.started_at,
        source: 'agent_run',
        severity: r.status === 'failed' ? 'error' : 'info',
        title: `Agent ${r.mode}/${r.agent_type}: ${r.status}`,
        data: { exitCode: r.exit_code, outcome: r.outcome, inputTokens: r.cost_input_tokens, outputTokens: r.cost_output_tokens },
      });
    }

    // 5. Task phases
    const phaseRows = db.prepare(
      'SELECT phase, status, started_at, completed_at FROM task_phases WHERE task_id = ?'
    ).all(taskId) as { phase: string; status: string; started_at: number | null; completed_at: number | null }[];
    for (const r of phaseRows) {
      entries.push({
        timestamp: r.started_at ?? r.completed_at ?? 0,
        source: 'phase',
        severity: r.status === 'failed' ? 'error' : 'info',
        title: `Phase ${r.phase}: ${r.status}`,
      });
    }

    // 6. Artifacts
    const artifactRows = db.prepare(
      'SELECT type, data, created_at FROM task_artifacts WHERE task_id = ?'
    ).all(taskId) as { type: string; data: string; created_at: number }[];
    for (const r of artifactRows) {
      entries.push({
        timestamp: r.created_at,
        source: 'artifact',
        severity: 'info',
        title: `Artifact: ${r.type}`,
        data: safeParse(r.data),
      });
    }

    // 7. Pending prompts
    const promptRows = db.prepare(
      'SELECT prompt_type, status, payload, response, created_at FROM pending_prompts WHERE task_id = ?'
    ).all(taskId) as { prompt_type: string; status: string; payload: string; response: string | null; created_at: number }[];
    for (const r of promptRows) {
      entries.push({
        timestamp: r.created_at,
        source: 'prompt',
        severity: 'info',
        title: `Prompt: ${r.prompt_type} (${r.status})`,
        data: { payload: safeParse(r.payload), response: safeParse(r.response) },
      });
    }

    // Sort by timestamp descending
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  });

  // ============================================
  // Dashboard Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.DASHBOARD_STATS, async () => {
    return services.workflowService.getDashboardStats();
  });
}
