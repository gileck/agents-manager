/**
 * Unit tests for field projection in get_task and list_tasks MCP tool handlers.
 *
 * Validates that identity fields (id, title, status) are always present
 * in the response regardless of the fields requested by the caller.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTaskMcpServer } from '../../src/core/mcp/task-mcp-server';

const FULL_TASK = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  title: 'Fix login bug',
  status: 'todo',
  description: 'Users cannot log in with SSO',
  priority: 1,
  type: 'bug',
  assignee: 'alice',
  tags: ['auth'],
  plan: '# Plan\nStep 1: investigate',
  technicalDesign: '# Design\nArchitecture overview',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  pipelineId: 'pipe-1',
  featureId: 'feat-1',
  size: 'md',
  complexity: 'medium',
  branchName: 'fix/login-bug',
  prLink: null,
};

// Mock the api-client module
vi.mock('../../src/client/api-client', () => ({
  createApiClient: vi.fn(() => ({
    tasks: {
      get: vi.fn().mockResolvedValue({ ...FULL_TASK }),
      list: vi.fn().mockResolvedValue([{ ...FULL_TASK }, { ...FULL_TASK, id: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Second task' }]),
      create: vi.fn(),
      update: vi.fn(),
      transition: vi.fn(),
    },
    settings: { get: vi.fn() },
    agents: { runs: vi.fn(), getActiveRuns: vi.fn(), getAllRuns: vi.fn() },
  })),
}));

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe('get_task handler — fields parameter', () => {
  let getTaskHandler: ToolHandler;

  beforeEach(async () => {
    const tools = await createTaskMcpServer('http://localhost:0', { projectId: 'proj-1' });
    const getTool = tools.find((t) => t.name === 'get_task');
    expect(getTool).toBeDefined();
    getTaskHandler = getTool!.handler as ToolHandler;
  });

  it('returns all fields when fields parameter is omitted', async () => {
    const result = await getTaskHandler({ taskId: FULL_TASK.id });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(FULL_TASK.id);
    expect(data.title).toBe(FULL_TASK.title);
    expect(data.status).toBe(FULL_TASK.status);
    expect(data.plan).toBe(FULL_TASK.plan);
  });

  it('always includes id, title, status even when not requested', async () => {
    const result = await getTaskHandler({ taskId: FULL_TASK.id, fields: ['plan', 'description'] });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    // Essential fields must always be present
    expect(data.id).toBe(FULL_TASK.id);
    expect(data.title).toBe(FULL_TASK.title);
    expect(data.status).toBe(FULL_TASK.status);
    // Requested fields must also be present
    expect(data.plan).toBe(FULL_TASK.plan);
    expect(data.description).toBe(FULL_TASK.description);
  });

  it('includes essential fields when only plan is requested', async () => {
    const result = await getTaskHandler({ taskId: FULL_TASK.id, fields: ['plan'] });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(FULL_TASK.id);
    expect(data.title).toBe(FULL_TASK.title);
    expect(data.status).toBe(FULL_TASK.status);
    expect(data.plan).toBe(FULL_TASK.plan);
    // Non-requested, non-essential fields should be absent
    expect(data.description).toBeUndefined();
    expect(data.assignee).toBeUndefined();
  });

  it('does not duplicate fields when essential fields are explicitly requested', async () => {
    const result = await getTaskHandler({ taskId: FULL_TASK.id, fields: ['id', 'title', 'status', 'plan'] });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe(FULL_TASK.id);
    expect(data.title).toBe(FULL_TASK.title);
    expect(data.status).toBe(FULL_TASK.status);
    expect(data.plan).toBe(FULL_TASK.plan);
  });
});

describe('list_tasks handler — fields parameter', () => {
  let listTasksHandler: ToolHandler;

  beforeEach(async () => {
    const tools = await createTaskMcpServer('http://localhost:0', { projectId: 'proj-1' });
    const listTool = tools.find((t) => t.name === 'list_tasks');
    expect(listTool).toBeDefined();
    listTasksHandler = listTool!.handler as ToolHandler;
  });

  it('always includes id, title, status even when custom fields are specified', async () => {
    const result = await listTasksHandler({ fields: ['plan', 'description'] });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text) as Array<Record<string, unknown>>;
    expect(data).toHaveLength(2);
    for (const task of data) {
      expect(task.id).toBeDefined();
      expect(task.title).toBeDefined();
      expect(task.status).toBeDefined();
      expect(task.plan).toBeDefined();
      expect(task.description).toBeDefined();
    }
  });

  it('returns default summary fields when fields parameter is omitted', async () => {
    const result = await listTasksHandler({});
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text) as Array<Record<string, unknown>>;
    expect(data).toHaveLength(2);
    for (const task of data) {
      expect(task.id).toBeDefined();
      expect(task.title).toBeDefined();
      expect(task.status).toBeDefined();
    }
  });
});
