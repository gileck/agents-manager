/**
 * Unit tests for task document-related MCP tool handlers:
 * - read_task_artifact: retrieval, 404, invalid type
 * - update_task: doc field routing to task_docs (not old columns)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTaskMcpServer } from '../../src/core/mcp/task-mcp-server';
import { createApiClient } from '../../src/client/api-client';

const TASK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const FULL_TASK = {
  id: TASK_ID,
  title: 'Test task',
  status: 'implementing',
  description: 'A test task',
};

const PLAN_DOC = {
  taskId: TASK_ID,
  type: 'plan' as const,
  content: '# Plan\nStep 1: do things',
  summary: 'Do things',
  updatedAt: 1700000000000,
};

let mockApi: ReturnType<typeof createApiClient>;

vi.mock('../../src/client/api-client', () => ({
  createApiClient: vi.fn(() => mockApi),
}));

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function getHandler(tools: Awaited<ReturnType<typeof createTaskMcpServer>>, name: string): ToolHandler {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool.handler as ToolHandler;
}

describe('read_task_artifact handler', () => {
  let handler: ToolHandler;

  beforeEach(async () => {
    mockApi = {
      tasks: {
        get: vi.fn().mockResolvedValue({ ...FULL_TASK }),
        list: vi.fn().mockResolvedValue([{ ...FULL_TASK }]),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ ...FULL_TASK }),
        transition: vi.fn(),
        addFeedback: vi.fn(),
      },
      settings: { get: vi.fn() },
      agents: { runs: vi.fn(), getActiveRuns: vi.fn(), getAllRuns: vi.fn() },
      taskDocs: {
        get: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    } as unknown as ReturnType<typeof createApiClient>;

    const tools = await createTaskMcpServer('http://localhost:0', { projectId: 'proj-1' });
    handler = getHandler(tools, 'read_task_artifact');
  });

  it('returns doc content on successful retrieval', async () => {
    (mockApi.taskDocs.get as ReturnType<typeof vi.fn>).mockResolvedValue(PLAN_DOC);

    const result = await handler({ taskId: TASK_ID, type: 'plan' });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.type).toBe('plan');
    expect(data.content).toBe(PLAN_DOC.content);
    expect(data.summary).toBe(PLAN_DOC.summary);
  });

  it('returns error when doc does not exist (404)', async () => {
    (mockApi.taskDocs.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await handler({ taskId: TASK_ID, type: 'investigation_report' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No investigation_report document found');
  });

  it('calls api.taskDocs.get with correct args', async () => {
    (mockApi.taskDocs.get as ReturnType<typeof vi.fn>).mockResolvedValue(PLAN_DOC);

    await handler({ taskId: TASK_ID, type: 'technical_design' });
    expect(mockApi.taskDocs.get).toHaveBeenCalledWith(TASK_ID, 'technical_design');
  });
});

describe('update_task handler — doc field routing', () => {
  let handler: ToolHandler;

  beforeEach(async () => {
    mockApi = {
      tasks: {
        get: vi.fn().mockResolvedValue({ ...FULL_TASK }),
        list: vi.fn().mockResolvedValue([{ ...FULL_TASK }]),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ ...FULL_TASK }),
        transition: vi.fn(),
        addFeedback: vi.fn(),
      },
      settings: { get: vi.fn() },
      agents: { runs: vi.fn(), getActiveRuns: vi.fn(), getAllRuns: vi.fn() },
      taskDocs: {
        get: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    } as unknown as ReturnType<typeof createApiClient>;

    const tools = await createTaskMcpServer('http://localhost:0', { projectId: 'proj-1' });
    handler = getHandler(tools, 'update_task');
  });

  it('routes plan field to task_docs and excludes it from task update', async () => {
    await handler({ taskId: TASK_ID, plan: '# New Plan' });

    // Should write to task_docs
    expect(mockApi.taskDocs.upsert).toHaveBeenCalledWith(TASK_ID, 'plan', '# New Plan');

    // Should NOT pass plan to api.tasks.update
    const updateCall = (mockApi.tasks.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateCall[1]).not.toHaveProperty('plan');
  });

  it('routes investigationReport field to task_docs', async () => {
    await handler({ taskId: TASK_ID, investigationReport: '# Report' });

    expect(mockApi.taskDocs.upsert).toHaveBeenCalledWith(TASK_ID, 'investigation_report', '# Report');

    const updateCall = (mockApi.tasks.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateCall[1]).not.toHaveProperty('investigationReport');
  });

  it('routes technicalDesign field to task_docs', async () => {
    await handler({ taskId: TASK_ID, technicalDesign: '# Design' });

    expect(mockApi.taskDocs.upsert).toHaveBeenCalledWith(TASK_ID, 'technical_design', '# Design');

    const updateCall = (mockApi.tasks.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateCall[1]).not.toHaveProperty('technicalDesign');
  });

  it('does not call upsert when doc field value is null (clear)', async () => {
    await handler({ taskId: TASK_ID, plan: null });

    // null means "clear" — we don't upsert but also don't error
    expect(mockApi.taskDocs.upsert).not.toHaveBeenCalled();
  });

  it('passes non-doc fields through to task update normally', async () => {
    await handler({ taskId: TASK_ID, title: 'New title', description: 'Updated desc', plan: '# Plan' });

    const updateCall = (mockApi.tasks.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateCall[1]).toHaveProperty('title', 'New title');
    expect(updateCall[1]).toHaveProperty('description', 'Updated desc');
    expect(updateCall[1]).not.toHaveProperty('plan');
  });

  it('logs warning when task_docs write fails (does not throw)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (mockApi.taskDocs.upsert as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

    const result = await handler({ taskId: TASK_ID, plan: '# Plan' });
    expect(result.isError).toBeFalsy(); // Should not fail overall
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
