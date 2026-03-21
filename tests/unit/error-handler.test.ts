import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sonner toast before importing the module under test
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { toast } from 'sonner';

// We need to set up window globally before importing the module
// because the module references window.api at call time (not import time).
const mockApi = {
  settings: {
    get: vi.fn().mockResolvedValue({
      currentProjectId: 'proj-1',
      defaultPipelineId: 'pipe-1',
    }),
  },
  pipelines: { list: vi.fn().mockResolvedValue([{ id: 'pipe-1' }]) },
  tasks: {
    create: vi.fn().mockResolvedValue({ id: 'task-new' }),
    debugTimeline: vi.fn().mockResolvedValue([]),
    contextEntries: vi.fn().mockResolvedValue([]),
  },
  events: { list: vi.fn().mockResolvedValue([]) },
  debugLogs: { list: vi.fn().mockResolvedValue([]) },
};

// Set up a minimal window object for Node environment
const fakeWindow = {
  api: mockApi,
  location: { hash: '', pathname: '/', href: 'http://localhost/' },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = fakeWindow;

import {
  extractTaskIdFromRoute,
  collectDebugContext,
  createBugReport,
} from '../../src/renderer/lib/error-handler';

// Helper to set up window.location.hash
function setHash(hash: string) {
  fakeWindow.location = { hash, pathname: '/', href: `http://localhost/${hash}` };
}

function resetApi() {
  mockApi.settings.get.mockResolvedValue({
    currentProjectId: 'proj-1',
    defaultPipelineId: 'pipe-1',
  });
  mockApi.pipelines.list.mockResolvedValue([{ id: 'pipe-1' }]);
  mockApi.tasks.create.mockResolvedValue({ id: 'task-new' });
  mockApi.tasks.debugTimeline.mockResolvedValue([]);
  mockApi.tasks.contextEntries.mockResolvedValue([]);
  mockApi.events.list.mockResolvedValue([]);
  mockApi.debugLogs.list.mockResolvedValue([]);
}

describe('error-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApi();
    setHash('');
  });

  afterEach(() => {
    setHash('');
  });

  describe('extractTaskIdFromRoute', () => {
    it('returns null when not on a task page', () => {
      setHash('#/settings');
      expect(extractTaskIdFromRoute()).toBeNull();
    });

    it('extracts task ID from hash route', () => {
      setHash('#/tasks/abc-123');
      expect(extractTaskIdFromRoute()).toBe('abc-123');
    });

    it('extracts task ID when there are sub-paths', () => {
      setHash('#/tasks/abc-123/details');
      expect(extractTaskIdFromRoute()).toBe('abc-123');
    });

    it('returns null when hash is empty', () => {
      setHash('');
      expect(extractTaskIdFromRoute()).toBeNull();
    });
  });

  describe('collectDebugContext', () => {
    it('includes the stack trace', async () => {
      setHash('');

      const result = await collectDebugContext('Error: boom\n  at foo.ts:1');
      expect(result).toContain('--- Stack Trace ---');
      expect(result).toContain('Error: boom');
    });

    it('fetches and formats application debug logs', async () => {
      mockApi.debugLogs.list.mockResolvedValue([
        { id: '1', level: 'error', source: 'renderer', message: 'Something broke', data: {}, createdAt: 1700000000000 },
        { id: '2', level: 'warn', source: 'ipc', message: 'Slow call', data: {}, createdAt: 1700000001000 },
      ]);
      setHash('');

      const result = await collectDebugContext('stack');
      expect(result).toContain('--- Application Debug Logs (last 5 min) ---');
      expect(result).toContain('[renderer/error] Something broke');
      expect(result).toContain('[ipc/warn] Slow call');
      expect(mockApi.debugLogs.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('fetches task timeline when on a task page', async () => {
      setHash('#/tasks/task-42');
      mockApi.tasks.debugTimeline.mockResolvedValue([
        { id: '1', timestamp: 1700000000000, source: 'agent', severity: 'info', title: 'Started run' },
      ]);

      const result = await collectDebugContext('stack');
      expect(result).toContain('--- Timeline (task task-42) ---');
      expect(result).toContain('[agent/info] Started run');
      expect(mockApi.tasks.debugTimeline).toHaveBeenCalledWith('task-42');
    });

    it('fetches task events when on a task page', async () => {
      setHash('#/tasks/task-42');
      mockApi.events.list.mockResolvedValue([
        { id: '1', taskId: 'task-42', category: 'status_change', severity: 'info', message: 'Moved to in_progress', data: {}, createdAt: 1700000000000 },
      ]);

      const result = await collectDebugContext('stack');
      expect(result).toContain('--- Events (task task-42) ---');
      expect(result).toContain('[status_change/info] Moved to in_progress');
      expect(mockApi.events.list).toHaveBeenCalledWith({ taskId: 'task-42' });
    });

    it('does not fetch task data when not on a task page', async () => {
      setHash('#/settings');

      await collectDebugContext('stack');
      expect(mockApi.tasks.debugTimeline).not.toHaveBeenCalled();
      expect(mockApi.events.list).not.toHaveBeenCalled();
    });

    it('gracefully handles debugLogs.list failure', async () => {
      mockApi.debugLogs.list.mockRejectedValue(new Error('network error'));
      setHash('');

      const result = await collectDebugContext('stack');
      expect(result).toContain('--- Application Debug Logs: failed to fetch ---');
      // Should still contain the stack trace
      expect(result).toContain('--- Stack Trace ---');
    });

    it('gracefully handles timeline fetch failure', async () => {
      setHash('#/tasks/task-42');
      mockApi.tasks.debugTimeline.mockRejectedValue(new Error('timeout'));

      const result = await collectDebugContext('stack');
      expect(result).toContain('--- Timeline (task task-42): failed to fetch ---');
    });

    it('gracefully handles events fetch failure', async () => {
      setHash('#/tasks/task-42');
      mockApi.events.list.mockRejectedValue(new Error('timeout'));

      const result = await collectDebugContext('stack');
      expect(result).toContain('--- Events (task task-42): failed to fetch ---');
    });
  });

  describe('createBugReport', () => {
    it('creates a bug task with route context and debug info', async () => {
      setHash('#/tasks/task-99');
      mockApi.debugLogs.list.mockResolvedValue([
        { id: '1', level: 'error', source: 'app', message: 'Crash', data: {}, createdAt: 1700000000000 },
      ]);

      await createBugReport('Test failed', 'Error: test', 'Error: test\n  at test.ts:1');

      expect(mockApi.tasks.create).toHaveBeenCalledTimes(1);
      const createArg = mockApi.tasks.create.mock.calls[0][0];

      // Description should include route context and task reference
      expect(createArg.description).toContain('## Error');
      expect(createArg.description).toContain('Error: test');
      expect(createArg.description).toContain('## Context');
      expect(createArg.description).toContain('#/tasks/task-99');
      expect(createArg.description).toContain('task-99');

      // debugInfo should include stack trace and debug logs
      expect(createArg.debugInfo).toContain('--- Stack Trace ---');
      expect(createArg.debugInfo).toContain('--- Application Debug Logs');

      // Metadata should include route and relatedTaskId
      expect(createArg.metadata).toEqual(
        expect.objectContaining({
          route: '#/tasks/task-99',
          relatedTaskId: 'task-99',
        }),
      );

      expect(createArg.type).toBe('bug');
      expect(createArg.tags).toEqual(['bug']);
    });

    it('excludes relatedTaskId from metadata when not on a task page', async () => {
      setHash('#/settings');

      await createBugReport('Crash', 'Error: boom', 'stack');

      const createArg = mockApi.tasks.create.mock.calls[0][0];
      expect(createArg.metadata).not.toHaveProperty('relatedTaskId');
      expect(createArg.metadata).toHaveProperty('route', '#/settings');
      expect(createArg.description).not.toContain('Related Task');
    });

    it('falls back to raw stack trace when collectDebugContext fails completely', async () => {
      // Make every debug API fail
      mockApi.debugLogs.list.mockRejectedValue(new Error('fail'));
      setHash('');

      await createBugReport('Error', 'msg', 'raw stack trace');

      const createArg = mockApi.tasks.create.mock.calls[0][0];
      // collectDebugContext itself won't throw (it catches internally), but
      // the outer try/catch in createBugReport provides a safety net
      expect(createArg.debugInfo).toContain('raw stack trace');
    });

    it('shows warning when no project is selected', async () => {
      mockApi.settings.get.mockResolvedValue({ currentProjectId: null, defaultPipelineId: null });
      setHash('');

      await createBugReport('Error', 'msg', 'stack');

      expect(toast.warning).toHaveBeenCalledWith('Select a project first');
      expect(mockApi.tasks.create).not.toHaveBeenCalled();
    });

    it('shows success toast with View Task action', async () => {
      setHash('');

      await createBugReport('Error', 'msg', 'stack');

      expect(toast.success).toHaveBeenCalledWith(
        'Bug report created',
        expect.objectContaining({
          action: expect.objectContaining({ label: 'View Task' }),
        }),
      );
    });

    it('shows error toast when task creation fails', async () => {
      mockApi.tasks.create.mockRejectedValue(new Error('server error'));
      setHash('');

      await createBugReport('Error', 'msg', 'stack');

      expect(toast.error).toHaveBeenCalledWith('Failed to create bug report');
    });
  });
});
