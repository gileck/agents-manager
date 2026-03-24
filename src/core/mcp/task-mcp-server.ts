import { z } from 'zod';
import { createApiClient } from '../../client/api-client';
import type { TaskType, TaskUpdateInput, DocArtifactType } from '../../shared/types';
import type { GenericMcpToolDefinition } from '../interfaces/mcp-tool';
import type { AgentSubscriptionRegistry } from '../services/agent-subscription-registry';
import { DOC_PHASES } from '../../shared/doc-phases';

type CallToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function resolveTaskId(api: ReturnType<typeof createApiClient>, input: string): Promise<string> {
  // Fast path: full UUID — return immediately without an API call
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    return input;
  }

  // Prefix match against the first segment (first 8 hex chars before the first dash)
  const tasks = await api.tasks.list({});
  const matches = tasks.filter((t) => t.id.split('-')[0] === input);

  if (matches.length === 0) {
    throw new Error(`Task not found: ${input}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous ID, ${matches.length} matches found`);
  }

  return matches[0].id;
}

/**
 * Scans a parsed JSON value for objects that look like tasks (have `id` + `status`).
 * Handles direct task objects, arrays of tasks, and one level of nesting (e.g. TransitionResult.task).
 */
function extractTaskIds(data: unknown): string[] {
  const ids: string[] = [];
  function scan(val: unknown): void {
    if (Array.isArray(val)) {
      for (const item of val) scan(item);
    } else if (val && typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      if (typeof obj.id === 'string' && obj.id.length > 0 && typeof obj.status === 'string' && obj.status.length > 0) {
        ids.push(obj.id);
      } else {
        // One level of nesting — catches TransitionResult { task: { id, status } }
        for (const nested of Object.values(obj)) {
          if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            const n = nested as Record<string, unknown>;
            if (typeof n.id === 'string' && n.id.length > 0 && typeof n.status === 'string' && n.status.length > 0) {
              ids.push(n.id);
            }
          }
        }
      }
    }
  }
  scan(data);
  return ids;
}

/**
 * Tools that automatically subscribe the session for agent-completion notifications.
 * list_tasks is intentionally excluded — subscribing to every task in a list doesn't make sense.
 */
const AUTO_SUBSCRIBE_TOOLS = new Set(['get_task', 'create_task', 'update_task', 'transition_task', 'request_changes']);

/**
 * Creates an array of generic in-process MCP tool definitions scoped to the given project context.
 * Tools call the daemon API directly via api-client. The returned definitions are engine-agnostic —
 * each engine adapter (e.g. ClaudeCodeLib) converts them into its own native server format.
 */
export async function createTaskMcpServer(
  daemonUrl: string,
  context: { projectId: string; sessionId?: string; subscriptionRegistry?: AgentSubscriptionRegistry },
): Promise<GenericMcpToolDefinition[]> {
  const api = createApiClient(daemonUrl);

  const tools = [
    // -------------------------------------------------------------------------
    // create_task
    // -------------------------------------------------------------------------
    {
      name: 'create_task',
      description:
        'Create a new task in the current project. If pipelineId is not provided, ' +
        'the application default pipeline is used. Returns the created task object. ' +
        'Automatically subscribes this session for agent-completion notifications on the ' +
        'created task. By default (autoNotify: true) the agent automatically starts a new ' +
        'turn when the notification arrives. Pass autoNotify: false for a UI-only ' +
        'notification with no automatic agent turn.',
      inputSchema: {
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
        priority: z.number().optional().describe('Task priority (numeric, lower = higher priority)'),
        type: z.string().optional().describe('Task type (e.g. "feature", "bug", "chore")'),
        tags: z.array(z.string()).optional().describe('Task tags'),
        featureId: z.string().optional().describe('Feature ID to associate this task with'),
        pipelineId: z.string().optional().describe('Pipeline ID. If omitted, the default pipeline from app settings is used.'),
        autoNotify: z.boolean().optional().describe(
          'If true (default), the agent will automatically start a new turn when the agent-completion ' +
          'notification arrives for this task. If false, only a UI notification is ' +
          'shown and the user can choose to engage. This is equivalent to calling ' +
          'subscribe_for_agent after the task is created.',
        ),
      },
      handler: async (args: {
        title: string;
        description?: string;
        priority?: number;
        type?: string;
        tags?: string[];
        featureId?: string;
        pipelineId?: string;
        autoNotify?: boolean;
      }): Promise<CallToolResult> => {
        try {
          let pipelineId = args.pipelineId;
          if (!pipelineId) {
            const settings = await api.settings.get();
            if (!settings.defaultPipelineId) {
              return fail(
                'No pipelineId provided and no default pipeline configured in app settings. ' +
                'Please provide a pipelineId explicitly.',
              );
            }
            pipelineId = settings.defaultPipelineId;
          }
          const task = await api.tasks.create({
            projectId: context.projectId,
            pipelineId,
            title: args.title,
            description: args.description,
            priority: args.priority,
            type: args.type as TaskType | undefined,
            tags: args.tags,
            featureId: args.featureId,
          });
          return ok(task);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // update_task
    // -------------------------------------------------------------------------
    {
      name: 'update_task',
      description:
        'Update fields on an existing task. Only the provided fields will be changed; ' +
        'omitted fields are left untouched. Pass null to clear optional fields. ' +
        'Automatically subscribes this session for agent-completion notifications on the ' +
        'updated task. By default (autoNotify: true) the agent automatically starts a new ' +
        'turn when the notification arrives. Pass autoNotify: false for a UI-only ' +
        'notification with no automatic agent turn.',
      inputSchema: {
        taskId: z.string().describe('Task ID (full UUID or 8-char short prefix, e.g. "326e8ec7")'),
        title: z.string().optional().describe('Task title'),
        description: z.string().nullable().optional().describe('Task description (null to clear)'),
        type: z.string().optional().describe('Task type: "bug", "feature", or "improvement"'),
        size: z.string().nullable().optional().describe('Task size: "xs", "sm", "md", "lg", or "xl" (null to clear)'),
        complexity: z.string().nullable().optional().describe('Task complexity: "low", "medium", or "high" (null to clear)'),
        priority: z.number().optional().describe('Numeric priority (lower = higher priority)'),
        assignee: z.string().nullable().optional().describe('Assignee name (null to clear)'),
        tags: z.array(z.string()).optional().describe('Array of tags'),
        pipelineId: z.string().optional().describe('Pipeline ID'),
        featureId: z.string().nullable().optional().describe('Feature ID (null to clear)'),
        parentTaskId: z.string().nullable().optional().describe('Parent task ID (null to clear)'),
        plan: z.string().nullable().optional().describe('Plan content (null to clear)'),
        investigationReport: z.string().nullable().optional().describe('Investigation report content (null to clear)'),
        technicalDesign: z.string().nullable().optional().describe('Technical design content (null to clear)'),
        debugInfo: z.string().nullable().optional().describe('Debug info (null to clear)'),
        prLink: z.string().nullable().optional().describe('PR link (null to clear)'),
        branchName: z.string().nullable().optional().describe('Branch name (null to clear)'),
        metadata: z.record(z.unknown()).optional().describe('Metadata object, merged into existing metadata'),
        phases: z.array(z.unknown()).nullable().optional().describe('Implementation phases JSON array (null to clear)'),
        autoNotify: z.boolean().optional().describe(
          'If true (default), the agent will automatically start a new turn when the agent-completion ' +
          'notification arrives for this task. If false, only a UI notification is ' +
          'shown and the user can choose to engage. This is equivalent to calling ' +
          'subscribe_for_agent after the update.',
        ),
      },
      handler: async (args: {
        taskId: string;
        title?: string;
        description?: string | null;
        type?: string;
        size?: string | null;
        complexity?: string | null;
        priority?: number;
        assignee?: string | null;
        tags?: string[];
        pipelineId?: string;
        featureId?: string | null;
        parentTaskId?: string | null;
        plan?: string | null;
        investigationReport?: string | null;
        technicalDesign?: string | null;
        debugInfo?: string | null;
        prLink?: string | null;
        branchName?: string | null;
        metadata?: Record<string, unknown>;
        phases?: unknown[] | null;
        autoNotify?: boolean;
      }): Promise<CallToolResult> => {
        try {
          const taskId = await resolveTaskId(api, args.taskId);

          // Intercept doc fields — route exclusively to task_docs table
          const DOC_FIELD_MAP: Array<{ field: 'plan' | 'investigationReport' | 'technicalDesign'; docType: DocArtifactType }> = [
            { field: 'plan', docType: 'plan' },
            { field: 'investigationReport', docType: 'investigation_report' },
            { field: 'technicalDesign', docType: 'technical_design' },
          ];

          const { taskId: _taskId, autoNotify: _autoNotify, plan: _plan, investigationReport: _ir, technicalDesign: _td, ...updateFields } = args;
          const task = await api.tasks.update(taskId, updateFields as TaskUpdateInput);

          // Write doc fields to task_docs table only
          for (const { field, docType } of DOC_FIELD_MAP) {
            const value = args[field];
            if (value !== undefined) {
              try {
                if (value === null) {
                  // null means "clear" — we don't delete the doc row, just set empty content
                  // (task_docs rows are cleared on task reset via deleteByTaskId)
                } else {
                  await api.taskDocs.upsert(taskId, docType, value);
                }
              } catch (err) {
                // eslint-disable-next-line no-console
                console.warn(`[update_task] write to task_docs failed (type=${docType}):`, err);
              }
            }
          }

          return ok(task);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // get_task
    // -------------------------------------------------------------------------
    {
      name: 'get_task',
      description:
        'Get details for a task by ID. By default returns all fields (title, description, status, ' +
        'plan, technical design, tags, and other metadata). Use the fields parameter to request ' +
        'only specific fields (e.g. ["plan", "status", "title"]) to reduce token usage. ' +
        'Automatically subscribes this session for agent-completion notifications on the task. ' +
        'By default (autoNotify: true) the agent automatically starts a new turn when the ' +
        'notification arrives. Pass autoNotify: false for a UI-only notification with no ' +
        'automatic agent turn.',
      inputSchema: {
        taskId: z.string().describe('Task ID (full UUID or 8-char short prefix, e.g. "326e8ec7")'),
        fields: z.array(z.string()).optional().describe('Specific fields to include in the response. When omitted, all fields are returned.'),
        autoNotify: z.boolean().optional().describe(
          'If true (default), the agent will automatically start a new turn when the agent-completion ' +
          'notification arrives for this task. If false, only a UI notification is ' +
          'shown and the user can choose to engage. This is equivalent to calling ' +
          'subscribe_for_agent after fetching the task.',
        ),
      },
      handler: async (args: { taskId: string; fields?: string[]; autoNotify?: boolean }): Promise<CallToolResult> => {
        try {
          const taskId = await resolveTaskId(api, args.taskId);
          const task = await api.tasks.get(taskId);
          if (args.fields) {
            const essentialFields = ['id', 'title', 'status'];
            const allFields = [...new Set([...essentialFields, ...args.fields])];
            const t = task as unknown as Record<string, unknown>;
            const result: Record<string, unknown> = {};
            for (const key of allFields) {
              if (key in t) result[key] = t[key];
            }
            return ok(result);
          }
          return ok(task);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // list_tasks
    // -------------------------------------------------------------------------
    {
      name: 'list_tasks',
      description:
        'List tasks with optional filters. Defaults to the current project scope. ' +
        'Returns a compact summary (id, title, status, priority, type, assignee, tags, dates). ' +
        'Use get_task(taskId) for full details including description, plan, and technical design.',
      inputSchema: {
        status: z.string().optional().describe('Filter by status (e.g. "todo", "in_progress", "done")'),
        projectId: z.string().optional().describe('Project ID. Defaults to the current project.'),
        assignee: z.string().optional().describe('Filter by assignee name or ID'),
        type: z.string().optional().describe('Filter by task type'),
        search: z.string().optional().describe('Free-text search across title and description'),
        limit: z.number().optional().describe('Maximum number of tasks to return. Defaults to 20.'),
        fields: z.array(z.string()).optional().describe('Specific fields to include in each task object. When omitted, a compact summary is returned.'),
      },
      handler: async (args: {
        status?: string;
        projectId?: string;
        assignee?: string;
        type?: string;
        search?: string;
        limit?: number;
        fields?: string[];
      }): Promise<CallToolResult> => {
        try {
          const tasks = await api.tasks.list({
            projectId: args.projectId ?? context.projectId,
            status: args.status,
            assignee: args.assignee,
            type: args.type as TaskType | undefined,
            search: args.search,
          });
          const limit = args.limit ?? 20;
          const sliced = tasks.slice(0, limit);
          const SUMMARY_FIELDS = new Set([
            'id', 'title', 'status', 'priority', 'type', 'assignee', 'tags',
            'createdAt', 'updatedAt', 'pipelineId', 'featureId', 'size',
            'complexity', 'branchName', 'prLink',
          ]);
          const essentialFields = ['id', 'title', 'status'];
          const fieldList = args.fields
            ? [...new Set([...essentialFields, ...args.fields])]
            : [...SUMMARY_FIELDS];
          const projected = sliced.map((task) => {
            const t = task as unknown as Record<string, unknown>;
            const result: Record<string, unknown> = {};
            for (const key of fieldList) {
              if (key in t) result[key] = t[key];
            }
            return result;
          });
          return ok(projected);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // transition_task
    // -------------------------------------------------------------------------
    {
      name: 'transition_task',
      description:
        'Move a task to a new pipeline status. You MUST supply the exact target status string. ' +
        'Never auto-select a status — always use an explicit value confirmed with the user. ' +
        'Use get_task to inspect valid transitions before calling this tool. ' +
        'Automatically subscribes this session for agent-completion notifications on the task. ' +
        'By default (autoNotify: true) the agent automatically starts a new turn when the ' +
        'notification arrives. Pass autoNotify: false for a UI-only notification with no ' +
        'automatic agent turn.',
      inputSchema: {
        taskId: z.string().describe('Task ID (full UUID or 8-char short prefix, e.g. "326e8ec7")'),
        status: z.string().describe('The exact target status to transition the task to'),
        autoNotify: z.boolean().optional().describe(
          'If true (default), the agent will automatically start a new turn when the agent-completion ' +
          'notification arrives for this task. If false, only a UI notification is ' +
          'shown and the user can choose to engage. This is equivalent to calling ' +
          'subscribe_for_agent after the transition.',
        ),
      },
      handler: async (args: { taskId: string; status: string; autoNotify?: boolean }): Promise<CallToolResult> => {
        try {
          const taskId = await resolveTaskId(api, args.taskId);
          const result = await api.tasks.transition(taskId, args.status);
          return ok(result);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // list_agent_runs
    // -------------------------------------------------------------------------
    {
      name: 'list_agent_runs',
      description:
        'List agent runs. When taskId is provided, returns runs for that task. ' +
        'When active is true, returns only currently active runs. ' +
        'Otherwise returns the most recent runs (up to limit).',
      inputSchema: {
        taskId: z.string().optional().describe('Task ID to filter runs by (full UUID or 8-char short prefix, e.g. "326e8ec7")'),
        active: z.boolean().optional().describe('If true, return only active (in-progress) runs'),
        limit: z.number().optional().describe('Maximum number of runs to return. Defaults to 20.'),
      },
      handler: async (args: { taskId?: string; active?: boolean; limit?: number }): Promise<CallToolResult> => {
        try {
          const limit = args.limit ?? 20;
          let runs: unknown[];
          if (args.taskId) {
            const taskId = await resolveTaskId(api, args.taskId);
            runs = await api.agents.runs(taskId);
          } else if (args.active) {
            runs = await api.agents.getActiveRuns();
          } else {
            runs = await api.agents.getAllRuns();
          }
          const STRIP_FIELDS = new Set(['output', 'messages', 'prompt', 'payload', 'error']);
          const projected = runs.slice(0, limit).map((run) => {
            const r = run as Record<string, unknown>;
            const result: Record<string, unknown> = {};
            for (const key of Object.keys(r)) {
              if (!STRIP_FIELDS.has(key)) result[key] = r[key];
            }
            return result;
          });
          return ok(projected);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // request_changes
    // -------------------------------------------------------------------------
    {
      name: 'request_changes',
      description:
        'Submit feedback and request changes for a task in a review stage. ' +
        'This is an atomic operation: it creates a TaskContextEntry with the feedback, ' +
        'then transitions the task back to the revision stage (e.g. plan_review → planning). ' +
        'Use this instead of manually calling transition_task when you want to send feedback ' +
        'that the revision agent can read. ' +
        'Automatically subscribes this session for agent-completion notifications on the task.',
      inputSchema: {
        taskId: z.string().describe('Task ID (full UUID or 8-char short prefix, e.g. "326e8ec7")'),
        feedback: z.string().describe(
          'Feedback content describing the requested changes. If empty, a default message is used.',
        ),
        feedbackType: z
          .enum(['plan_feedback', 'design_feedback', 'implementation_feedback'])
          .describe(
            'Type of feedback. Determines the target revision stage: ' +
            'plan_feedback → planning, design_feedback → designing, implementation_feedback → implementing',
          ),
        autoNotify: z.boolean().optional().describe(
          'If true (default), the agent will automatically start a new turn when the agent-completion ' +
          'notification arrives for this task. If false, only a UI notification is ' +
          'shown and the user can choose to engage.',
        ),
      },
      handler: async (args: {
        taskId: string;
        feedback: string;
        feedbackType: 'plan_feedback' | 'design_feedback' | 'implementation_feedback';
        autoNotify?: boolean;
      }): Promise<CallToolResult> => {
        try {
          const taskId = await resolveTaskId(api, args.taskId);

          // Determine target status from feedback type
          const TARGET_STATUS: Record<string, string> = {
            plan_feedback: 'planning',
            design_feedback: 'designing',
            implementation_feedback: 'implementing',
          };
          const targetStatus = TARGET_STATUS[args.feedbackType];
          if (!targetStatus) {
            return fail(`Unknown feedbackType: ${args.feedbackType}`);
          }

          // Default feedback message if empty
          const DEFAULT_MESSAGES: Record<string, string> = {
            plan_feedback: 'Changes requested to the plan.',
            design_feedback: 'Changes requested to the design.',
            implementation_feedback: 'Changes requested to the implementation.',
          };
          const feedbackContent = args.feedback?.trim() || DEFAULT_MESSAGES[args.feedbackType];

          // Step 1: Submit feedback as a TaskContextEntry
          await api.tasks.addFeedback(taskId, {
            entryType: args.feedbackType,
            content: feedbackContent,
            source: 'orchestrator',
          });

          // Step 2: Transition task back to the revision stage
          const result = await api.tasks.transition(taskId, targetStatus);
          return ok(result);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // read_task_artifact
    // -------------------------------------------------------------------------
    {
      name: 'read_task_artifact',
      description:
        'Read the full content of a task document artifact by type. ' +
        'Use this to retrieve the complete investigation report, plan, or technical design ' +
        'when only a summary was provided in the agent prompt context.',
      inputSchema: {
        taskId: z.string().describe('Task ID (full UUID or 8-char short prefix, e.g. "326e8ec7")'),
        type: z.enum(DOC_PHASES.map(p => p.docType) as [string, ...string[]]).describe(
          'Document type to retrieve',
        ),
      },
      handler: async (args: {
        taskId: string;
        type: 'investigation_report' | 'plan' | 'technical_design';
      }): Promise<CallToolResult> => {
        try {
          const taskId = await resolveTaskId(api, args.taskId);
          const doc = await api.taskDocs.get(taskId, args.type as DocArtifactType);
          if (!doc) {
            return fail(`No ${args.type} document found for task ${taskId}`);
          }
          return ok({
            type: doc.type,
            content: doc.content,
            summary: doc.summary,
            updatedAt: doc.updatedAt,
          });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // subscribe_for_agent
    // -------------------------------------------------------------------------
    {
      name: 'subscribe_for_agent',
      description:
        'Subscribe to receive a notification when a pipeline agent finishes ' +
        'for the given task. The notification will be delivered to this chat ' +
        'session when the task transitions to a new status after agent completion. ' +
        'Subscription is single-fire (auto-removed after delivery) and expires ' +
        'after 1 hour. Returns immediately — agent continues chatting normally. ' +
        'Note: get_task, create_task, update_task, and transition_task automatically ' +
        'subscribe this session without needing to call this tool explicitly.',
      inputSchema: {
        taskId: z.string().describe(
          'Task ID to watch (full UUID or 8-char short prefix)',
        ),
        autoNotify: z.boolean().optional().describe(
          'If true (default), the agent will automatically start a new turn to process ' +
          'the notification. If false, only a client-side UI ' +
          'notification is shown and the user can choose to engage.',
        ),
      },
      handler: async (args: {
        taskId: string;
        autoNotify?: boolean;
      }): Promise<CallToolResult> => {
        if (!context.sessionId) {
          return fail('subscribe_for_agent requires a session context');
        }
        if (!context.subscriptionRegistry) {
          return fail('Subscription registry not available');
        }
        try {
          const taskId = await resolveTaskId(api, args.taskId);
          context.subscriptionRegistry.subscribe({
            sessionId: context.sessionId,
            taskId,
            autoNotify: args.autoNotify ?? true,
            createdAt: Date.now(),
          });
          return ok({
            subscribed: true,
            taskId,
            sessionId: context.sessionId,
            autoNotify: args.autoNotify ?? true,
          });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // list_agent_types
    // -------------------------------------------------------------------------
    {
      name: 'list_agent_types',
      description:
        'List all available agent types that can be configured via file-based ' +
        'definitions (.agents/ directory). Returns an array of agent type names ' +
        '(e.g. "planner", "implementor", "reviewer").',
      inputSchema: {},
      handler: async (): Promise<CallToolResult> => {
        try {
          const types = await api.agentDefinitions.listTypes();
          return ok(types);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // get_agent_config
    // -------------------------------------------------------------------------
    {
      name: 'get_agent_config',
      description:
        'Get the effective configuration for an agent type, showing which fields ' +
        'come from file-based config (.agents/) vs hardcoded defaults. Returns the ' +
        'prompt, execution parameters (maxTurns, timeout, readOnly, disallowedTools), ' +
        'and per-field source attribution. Use this to inspect how an agent is configured ' +
        'before modifying its prompt or parameters.',
      inputSchema: {
        agentType: z.string().describe('Agent type (e.g. "planner", "implementor", "reviewer")'),
        projectId: z.string().optional().describe('Project ID. Defaults to the current project.'),
      },
      handler: async (args: { agentType: string; projectId?: string }): Promise<CallToolResult> => {
        try {
          const projectId = args.projectId ?? context.projectId;
          const config = await api.agentDefinitions.getEffective(args.agentType, projectId);
          return ok(config);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },

    // -------------------------------------------------------------------------
    // update_agent_prompt
    // -------------------------------------------------------------------------
    {
      name: 'update_agent_prompt',
      description:
        'Write or update the prompt.md file for an agent type in the project\'s ' +
        '.agents/ directory. This creates or overwrites the file at ' +
        '{projectPath}/.agents/{agentType}/prompt.md. The prompt supports ' +
        'PromptRenderer variable substitution: {taskTitle}, {taskDescription}, ' +
        '{planSection}, {technicalDesignSection}, {subtasksSection}, etc. ' +
        'Changes take effect on the next agent run.',
      inputSchema: {
        agentType: z.string().describe('Agent type (e.g. "planner", "implementor", "reviewer")'),
        content: z.string().describe('The prompt content to write to prompt.md'),
        projectId: z.string().optional().describe('Project ID. Defaults to the current project.'),
      },
      handler: async (args: { agentType: string; content: string; projectId?: string }): Promise<CallToolResult> => {
        try {
          const projectId = args.projectId ?? context.projectId;
          const result = await api.agentDefinitions.updatePrompt(args.agentType, projectId, args.content);
          return ok(result);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },
  ];

  // Wrap all tool handlers with a post-handler that:
  // 1. Tracks task IDs in the session (via the track-task endpoint).
  // 2. Auto-subscribes for agent-completion notifications for tools in AUTO_SUBSCRIBE_TOOLS.
  //    list_tasks is excluded — subscribing to every task in a list doesn't make sense.
  //    The autoNotify flag from the tool args controls whether the subscription triggers an
  //    automatic agent turn (true, default) or just a UI notification (false).
  const trackedTools = context.sessionId
    ? tools.map((tool) => ({
        ...tool,
        handler: async (args: Parameters<typeof tool.handler>[0]): Promise<CallToolResult> => {
          const result = await (tool.handler as (a: typeof args) => Promise<CallToolResult>)(args);
          if (!result.isError) {
            for (const part of result.content) {
              if (part.type === 'text') {
                try {
                  const parsed: unknown = JSON.parse(part.text);
                  const taskIds = extractTaskIds(parsed);
                  for (const taskId of taskIds) {
                    fetch(`${daemonUrl}/api/chat/sessions/${context.sessionId}/track-task`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ taskId }),
                    }).catch(() => { /* fire-and-forget */ });
                  }
                  // Auto-subscribe for agent-completion notifications
                  if (AUTO_SUBSCRIBE_TOOLS.has(tool.name) && context.subscriptionRegistry && taskIds.length > 0) {
                    const autoNotify = (args as Record<string, unknown>).autoNotify !== false;
                    for (const taskId of taskIds) {
                      try {
                        context.subscriptionRegistry.subscribe({
                          sessionId: context.sessionId!,
                          taskId,
                          autoNotify,
                          createdAt: Date.now(),
                        });
                      } catch (e) {
                        if (e instanceof Error && e.message.startsWith('Subscription limit reached')) {
                          // Expected: per-session cap hit — silently skip
                        } else {
                          // Unexpected error — log at debug level so it remains visible during development
                          // eslint-disable-next-line no-console
                          console.debug('[auto-subscribe] unexpected subscription error:', e);
                        }
                      }
                    }
                  }
                } catch {
                  // JSON parse failed — not a task result, skip
                }
              }
            }
          }
          return result;
        },
      }))
    : tools;

  // Cast is required because individual tool handlers use specific arg types (a sound narrowing
  // from GenericMcpToolDefinition.handler: (args: unknown) => Promise<unknown>). At runtime
  // each engine passes correctly-typed args, so this is safe.
  return trackedTools as unknown as GenericMcpToolDefinition[];
}
