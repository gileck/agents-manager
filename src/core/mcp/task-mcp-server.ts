import { z } from 'zod';
import { createApiClient } from '../../client/api-client';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';

// Use Function constructor to preserve dynamic import() at runtime.
// TypeScript compiles `await import(...)` to `require()` under CommonJS,
// but the SDK is ESM-only (.mjs). This bypasses that transformation.
const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

type CallToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Creates an in-process MCP server that exposes task management tools to the chat agent.
 * Tools call the daemon API directly via api-client, scoped to the given projectId context.
 */
export async function createTaskMcpServer(
  daemonUrl: string,
  context: { projectId: string },
): Promise<McpSdkServerConfigWithInstance> {
  const sdk = await importESM('@anthropic-ai/claude-agent-sdk');
  const createSdkMcpServer = sdk.createSdkMcpServer as (opts: {
    name: string;
    version?: string;
    tools?: unknown[];
  }) => McpSdkServerConfigWithInstance;

  const api = createApiClient(daemonUrl);

  const tools = [
    // -------------------------------------------------------------------------
    // create_task
    // -------------------------------------------------------------------------
    {
      name: 'create_task',
      description:
        'Create a new task in the current project. If pipelineId is not provided, ' +
        'the application default pipeline is used. Returns the created task object.',
      inputSchema: {
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
        priority: z.number().optional().describe('Task priority (numeric, lower = higher priority)'),
        type: z.string().optional().describe('Task type (e.g. "feature", "bug", "chore")'),
        tags: z.array(z.string()).optional().describe('Task tags'),
        featureId: z.string().optional().describe('Feature ID to associate this task with'),
        pipelineId: z.string().optional().describe('Pipeline ID. If omitted, the default pipeline from app settings is used.'),
      },
      handler: async (args: {
        title: string;
        description?: string;
        priority?: number;
        type?: string;
        tags?: string[];
        featureId?: string;
        pipelineId?: string;
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
            type: args.type as import('../../shared/types').TaskType | undefined,
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
    // get_task
    // -------------------------------------------------------------------------
    {
      name: 'get_task',
      description:
        'Get full details for a task by ID, including its title, description, status, ' +
        'plan, technical design, tags, and other metadata.',
      inputSchema: {
        taskId: z.string().describe('Task ID'),
      },
      handler: async (args: { taskId: string }): Promise<CallToolResult> => {
        try {
          const task = await api.tasks.get(args.taskId);
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
        'Returns an array of task objects.',
      inputSchema: {
        status: z.string().optional().describe('Filter by status (e.g. "todo", "in_progress", "done")'),
        projectId: z.string().optional().describe('Project ID. Defaults to the current project.'),
        assignee: z.string().optional().describe('Filter by assignee name or ID'),
        type: z.string().optional().describe('Filter by task type'),
        search: z.string().optional().describe('Free-text search across title and description'),
      },
      handler: async (args: {
        status?: string;
        projectId?: string;
        assignee?: string;
        type?: string;
        search?: string;
      }): Promise<CallToolResult> => {
        try {
          const tasks = await api.tasks.list({
            projectId: args.projectId ?? context.projectId,
            status: args.status,
            assignee: args.assignee,
            type: args.type as import('../../shared/types').TaskType | undefined,
            search: args.search,
          });
          return ok(tasks);
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
        'Use get_task to inspect valid transitions before calling this tool.',
      inputSchema: {
        taskId: z.string().describe('Task ID'),
        status: z.string().describe('The exact target status to transition the task to'),
      },
      handler: async (args: { taskId: string; status: string }): Promise<CallToolResult> => {
        try {
          const result = await api.tasks.transition(args.taskId, args.status);
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
        'Otherwise returns all recent runs.',
      inputSchema: {
        taskId: z.string().optional().describe('Task ID to filter runs by'),
        active: z.boolean().optional().describe('If true, return only active (in-progress) runs'),
      },
      handler: async (args: { taskId?: string; active?: boolean }): Promise<CallToolResult> => {
        try {
          let runs: unknown[];
          if (args.taskId) {
            runs = await api.agents.runs(args.taskId);
          } else if (args.active) {
            runs = await api.agents.getActiveRuns();
          } else {
            runs = await api.agents.getAllRuns();
          }
          return ok(runs);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },
  ];

  return createSdkMcpServer({ name: 'task-manager', tools });
}
