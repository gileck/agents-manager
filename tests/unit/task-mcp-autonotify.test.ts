/**
 * Tests for autoNotify default behavior in task MCP server.
 *
 * Validates that:
 * 1. AgentSubscriptionRegistry correctly stores/retrieves autoNotify flag
 * 2. Subscriptions are persistent (not single-fire) and survive multiple reads
 * 3. Subscriptions are cleaned up when a task reaches a terminal state
 * 4. Auto-subscribe wrapper in create_task/get_task/update_task/transition_task
 *    registers subscriptions with autoNotify: true by default
 * 5. subscribe_for_agent defaults autoNotify to true
 * 6. Tier 2 delivery: subscriptions with autoNotify: true trigger agent turn
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentSubscriptionRegistry } from '../../src/core/services/agent-subscription-registry';
import { createTaskMcpServer } from '../../src/core/mcp/task-mcp-server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const TASK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SESSION_ID = 'session-1';

const FULL_TASK = {
  id: TASK_ID,
  title: 'Fix login bug',
  status: 'todo',
  description: 'Users cannot log in with SSO',
  priority: 1,
  type: 'bug',
  assignee: 'alice',
  tags: ['auth'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  pipelineId: 'pipe-1',
};

const mockApi = {
  tasks: {
    get: vi.fn().mockResolvedValue({ ...FULL_TASK }),
    list: vi.fn().mockResolvedValue([{ ...FULL_TASK }]),
    create: vi.fn().mockResolvedValue({ ...FULL_TASK }),
    update: vi.fn().mockResolvedValue({ ...FULL_TASK }),
    transition: vi.fn().mockResolvedValue({ task: { ...FULL_TASK, status: 'in_progress' } }),
  },
  settings: { get: vi.fn().mockResolvedValue({ defaultPipelineId: 'pipe-1' }) },
  agents: { runs: vi.fn(), getActiveRuns: vi.fn(), getAllRuns: vi.fn() },
};

vi.mock('../../src/client/api-client', () => ({
  createApiClient: vi.fn(() => mockApi),
}));

// Suppress fire-and-forget fetch calls from the track-task wrapper
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

// ---------------------------------------------------------------------------
// 1. AgentSubscriptionRegistry unit tests
// ---------------------------------------------------------------------------

describe('AgentSubscriptionRegistry — autoNotify flag', () => {
  let registry: AgentSubscriptionRegistry;

  beforeEach(() => {
    registry = new AgentSubscriptionRegistry();
  });

  afterEach(() => {
    registry.dispose();
  });

  it('stores autoNotify: true and returns it via get', () => {
    registry.subscribe({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      autoNotify: true,
      createdAt: Date.now(),
    });

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(true);
    expect(subs[0].sessionId).toBe(SESSION_ID);
  });

  it('stores autoNotify: false and returns it via get', () => {
    registry.subscribe({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      autoNotify: false,
      createdAt: Date.now(),
    });

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(false);
  });

  it('get returns subscribers persistently (not single-fire)', () => {
    registry.subscribe({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      autoNotify: true,
      createdAt: Date.now(),
    });

    const first = registry.get(TASK_ID);
    expect(first).toHaveLength(1);

    // Second call should still return the subscription (persistent)
    const second = registry.get(TASK_ID);
    expect(second).toHaveLength(1);
    expect(second[0].sessionId).toBe(SESSION_ID);
  });

  it('subscription fires again on second agent completion for the same task', () => {
    registry.subscribe({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      autoNotify: true,
      createdAt: Date.now(),
    });

    // Simulate first agent completion notification
    const firstRound = registry.get(TASK_ID);
    expect(firstRound).toHaveLength(1);

    // Simulate second agent completion (e.g. planner after designer)
    const secondRound = registry.get(TASK_ID);
    expect(secondRound).toHaveLength(1);
    expect(secondRound[0].sessionId).toBe(SESSION_ID);
    expect(secondRound[0].autoNotify).toBe(true);

    // Simulate third agent completion (e.g. implementor after planner)
    const thirdRound = registry.get(TASK_ID);
    expect(thirdRound).toHaveLength(1);
  });

  it('does not duplicate subscription from same session', () => {
    const sub = {
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      autoNotify: true,
      createdAt: Date.now(),
    };
    registry.subscribe(sub);
    registry.subscribe(sub);

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
  });

  it('supports multiple sessions subscribing to the same task', () => {
    registry.subscribe({
      sessionId: 'session-a',
      taskId: TASK_ID,
      autoNotify: true,
      createdAt: Date.now(),
    });
    registry.subscribe({
      sessionId: 'session-b',
      taskId: TASK_ID,
      autoNotify: false,
      createdAt: Date.now(),
    });

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(2);
    expect(subs.find(s => s.sessionId === 'session-a')!.autoNotify).toBe(true);
    expect(subs.find(s => s.sessionId === 'session-b')!.autoNotify).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 1b. AgentSubscriptionRegistry — removeTask and terminal state cleanup
// ---------------------------------------------------------------------------

describe('AgentSubscriptionRegistry — removeTask and terminal state cleanup', () => {
  let registry: AgentSubscriptionRegistry;

  beforeEach(() => {
    registry = new AgentSubscriptionRegistry();
  });

  afterEach(() => {
    registry.dispose();
  });

  it('removeTask cleans up all subscriptions for a task', () => {
    registry.subscribe({
      sessionId: 'session-a',
      taskId: TASK_ID,
      autoNotify: true,
      createdAt: Date.now(),
    });
    registry.subscribe({
      sessionId: 'session-b',
      taskId: TASK_ID,
      autoNotify: true,
      createdAt: Date.now(),
    });

    expect(registry.get(TASK_ID)).toHaveLength(2);
    expect(registry.hasSubscribers(TASK_ID)).toBe(true);

    registry.removeTask(TASK_ID);

    expect(registry.get(TASK_ID)).toHaveLength(0);
    expect(registry.hasSubscribers(TASK_ID)).toBe(false);
  });

  it('removeTask does not affect other tasks', () => {
    const otherTaskId = 'ffffffff-0000-1111-2222-333333333333';

    registry.subscribe({
      sessionId: SESSION_ID,
      taskId: TASK_ID,
      autoNotify: true,
      createdAt: Date.now(),
    });
    registry.subscribe({
      sessionId: SESSION_ID,
      taskId: otherTaskId,
      autoNotify: true,
      createdAt: Date.now(),
    });

    registry.removeTask(TASK_ID);

    expect(registry.get(TASK_ID)).toHaveLength(0);
    expect(registry.get(otherTaskId)).toHaveLength(1);
  });

  it('isTerminalStatus returns true for done, closed, cancelled', () => {
    expect(AgentSubscriptionRegistry.isTerminalStatus('done')).toBe(true);
    expect(AgentSubscriptionRegistry.isTerminalStatus('closed')).toBe(true);
    expect(AgentSubscriptionRegistry.isTerminalStatus('cancelled')).toBe(true);
  });

  it('isTerminalStatus returns false for non-terminal statuses', () => {
    expect(AgentSubscriptionRegistry.isTerminalStatus('todo')).toBe(false);
    expect(AgentSubscriptionRegistry.isTerminalStatus('in_progress')).toBe(false);
    expect(AgentSubscriptionRegistry.isTerminalStatus('open')).toBe(false);
    expect(AgentSubscriptionRegistry.isTerminalStatus('review')).toBe(false);
  });

  it('removeTask is safe to call on non-existent task', () => {
    expect(() => registry.removeTask('non-existent-task')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Auto-subscribe wrapper tests (create_task, get_task, etc.)
// ---------------------------------------------------------------------------

describe('auto-subscribe wrapper — autoNotify defaults to true', () => {
  let registry: AgentSubscriptionRegistry;
  let tools: Awaited<ReturnType<typeof createTaskMcpServer>>;

  beforeEach(async () => {
    registry = new AgentSubscriptionRegistry();
    tools = await createTaskMcpServer('http://localhost:0', {
      projectId: 'proj-1',
      sessionId: SESSION_ID,
      subscriptionRegistry: registry,
    });
  });

  afterEach(() => {
    registry.dispose();
  });

  function findHandler(name: string): ToolHandler {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool.handler as ToolHandler;
  }

  it('create_task auto-subscribes with autoNotify: true by default', async () => {
    const handler = findHandler('create_task');
    const result = await handler({ title: 'New task' });
    expect(result.isError).toBeFalsy();

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(true);
  });

  it('get_task auto-subscribes with autoNotify: true by default', async () => {
    const handler = findHandler('get_task');
    const result = await handler({ taskId: TASK_ID });
    expect(result.isError).toBeFalsy();

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(true);
  });

  it('update_task auto-subscribes with autoNotify: true by default', async () => {
    const handler = findHandler('update_task');
    const result = await handler({ taskId: TASK_ID, title: 'Updated title' });
    expect(result.isError).toBeFalsy();

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(true);
  });

  it('transition_task auto-subscribes with autoNotify: true by default', async () => {
    const handler = findHandler('transition_task');
    const result = await handler({ taskId: TASK_ID, status: 'in_progress' });
    expect(result.isError).toBeFalsy();

    // transition returns { task: { id, status } } — extractTaskIds finds nested task
    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(true);
  });

  it('create_task respects explicit autoNotify: false', async () => {
    const handler = findHandler('create_task');
    const result = await handler({ title: 'New task', autoNotify: false });
    expect(result.isError).toBeFalsy();

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(false);
  });

  it('get_task respects explicit autoNotify: false', async () => {
    const handler = findHandler('get_task');
    const result = await handler({ taskId: TASK_ID, autoNotify: false });
    expect(result.isError).toBeFalsy();

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. subscribe_for_agent tool tests
// ---------------------------------------------------------------------------

describe('subscribe_for_agent — autoNotify defaults to true', () => {
  let registry: AgentSubscriptionRegistry;
  let handler: ToolHandler;

  beforeEach(async () => {
    registry = new AgentSubscriptionRegistry();
    const tools = await createTaskMcpServer('http://localhost:0', {
      projectId: 'proj-1',
      sessionId: SESSION_ID,
      subscriptionRegistry: registry,
    });
    const tool = tools.find((t) => t.name === 'subscribe_for_agent');
    expect(tool).toBeDefined();
    handler = tool!.handler as ToolHandler;
  });

  afterEach(() => {
    registry.dispose();
  });

  it('defaults autoNotify to true when omitted', async () => {
    const result = await handler({ taskId: TASK_ID });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.autoNotify).toBe(true);

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(true);
  });

  it('respects explicit autoNotify: false', async () => {
    const result = await handler({ taskId: TASK_ID, autoNotify: false });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.autoNotify).toBe(false);

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(false);
  });

  it('respects explicit autoNotify: true', async () => {
    const result = await handler({ taskId: TASK_ID, autoNotify: true });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.autoNotify).toBe(true);

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Tier 2 delivery: autoNotify true triggers injected message path
// ---------------------------------------------------------------------------

describe('Tier 2 delivery — autoNotify flag determines agent trigger', () => {
  let registry: AgentSubscriptionRegistry;

  beforeEach(() => {
    registry = new AgentSubscriptionRegistry();
  });

  afterEach(() => {
    registry.dispose();
  });

  it('get returns autoNotify: true for default subscriptions (persistent)', async () => {
    // Simulate what the auto-subscribe wrapper does after create_task
    const tools = await createTaskMcpServer('http://localhost:0', {
      projectId: 'proj-1',
      sessionId: SESSION_ID,
      subscriptionRegistry: registry,
    });
    const createHandler = (tools.find(t => t.name === 'create_task')!.handler) as ToolHandler;
    await createHandler({ title: 'Test task' });

    // Simulate what agent-service.ts does on task completion:
    // it calls get and checks sub.autoNotify
    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);

    // With persistent subscriptions, autoNotify should be true → Tier 2 fires
    const sub = subs[0];
    expect(sub.autoNotify).toBe(true);

    // Verify the subscription contains the correct session info
    expect(sub.sessionId).toBe(SESSION_ID);
    expect(sub.taskId).toBe(TASK_ID);

    // Subscription should still exist for the next agent completion
    const secondRound = registry.get(TASK_ID);
    expect(secondRound).toHaveLength(1);
    expect(secondRound[0].autoNotify).toBe(true);
  });

  it('autoNotify: false skips Tier 2 (only UI notification)', async () => {
    const tools = await createTaskMcpServer('http://localhost:0', {
      projectId: 'proj-1',
      sessionId: SESSION_ID,
      subscriptionRegistry: registry,
    });
    const createHandler = (tools.find(t => t.name === 'create_task')!.handler) as ToolHandler;
    await createHandler({ title: 'Test task', autoNotify: false });

    const subs = registry.get(TASK_ID);
    expect(subs).toHaveLength(1);
    expect(subs[0].autoNotify).toBe(false);
    // agent-service.ts would skip Tier 2 for this subscription
  });
});
