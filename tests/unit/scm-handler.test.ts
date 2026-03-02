import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IProjectStore } from '../../src/core/interfaces/project-store';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { ITaskArtifactStore } from '../../src/core/interfaces/task-artifact-store';
import type { ITaskEventLog } from '../../src/core/interfaces/task-event-log';
import type { IWorktreeManager } from '../../src/core/interfaces/worktree-manager';
import type { IGitOps } from '../../src/core/interfaces/git-ops';
import type { IScmPlatform } from '../../src/core/interfaces/scm-platform';
import type { IPipelineEngine } from '../../src/core/interfaces/pipeline-engine';
import type { Task, Transition, TransitionContext, HookResult, TaskArtifact, TaskEvent, Project } from '../../src/shared/types';
import { registerScmHandler, type ScmHandlerDeps } from '../../src/core/handlers/scm-handler';

// Helper to create a minimal Task for testing
function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    pipelineId: 'pipeline-1',
    title: 'Test Task',
    description: null,
    debugInfo: null,
    status: 'in_progress',
    priority: 0,
    tags: [],
    parentTaskId: null,
    featureId: null,
    assignee: null,
    prLink: null,
    branchName: null,
    plan: null,
    technicalDesign: null,
    subtasks: [],
    phases: null,
    planComments: [],
    technicalDesignComments: [],
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeTransition(overrides?: Partial<Transition>): Transition {
  return {
    from: 'reviewing',
    to: 'done',
    trigger: 'system',
    ...overrides,
  };
}

function makeContext(overrides?: Partial<TransitionContext>): TransitionContext {
  return {
    trigger: 'system',
    ...overrides,
  };
}

function makeArtifact(overrides?: Partial<TaskArtifact>): TaskArtifact {
  return {
    id: 'art-1',
    taskId: 'task-1',
    type: 'pr',
    data: { url: 'https://github.com/owner/repo/pull/42', branch: 'task/task-1/implement' },
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('registerScmHandler', () => {
  // Registered hooks keyed by hook name
  let hooks: Record<string, (task: Task, transition: Transition, context: TransitionContext, params?: Record<string, unknown>) => Promise<HookResult>>;

  // Mocks
  let mockProjectStore: IProjectStore;
  let mockTaskStore: ITaskStore;
  let mockTaskArtifactStore: ITaskArtifactStore;
  let mockTaskEventLog: ITaskEventLog;
  let mockWorktreeManager: IWorktreeManager;
  let mockGitOps: IGitOps;
  let mockScmPlatform: IScmPlatform;
  let deps: ScmHandlerDeps;

  beforeEach(() => {
    hooks = {};

    const mockEngine: IPipelineEngine = {
      registerHook: vi.fn((name: string, fn: (...args: unknown[]) => Promise<HookResult>) => {
        hooks[name] = fn as (task: Task, transition: Transition, context: TransitionContext, params?: Record<string, unknown>) => Promise<HookResult>;
      }),
      registerGuard: vi.fn(),
      executeTransition: vi.fn(),
    } as unknown as IPipelineEngine;

    mockProjectStore = {
      getProject: vi.fn().mockResolvedValue({
        id: 'proj-1',
        name: 'Test Project',
        description: null,
        path: '/home/test/project',
        config: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies Project),
      listProjects: vi.fn(),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
    };

    mockTaskStore = {
      getTask: vi.fn().mockResolvedValue(makeTask()),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn().mockResolvedValue(makeTask()),
      deleteTask: vi.fn(),
      resetTask: vi.fn(),
      addDependency: vi.fn(),
      removeDependency: vi.fn(),
      getDependencies: vi.fn(),
      getDependents: vi.fn(),
      getStatusCounts: vi.fn(),
      getTotalCount: vi.fn(),
    };

    mockTaskArtifactStore = {
      getArtifactsForTask: vi.fn().mockResolvedValue([]),
      createArtifact: vi.fn().mockResolvedValue(makeArtifact()),
      deleteArtifactsForTask: vi.fn(),
    };

    mockTaskEventLog = {
      log: vi.fn().mockResolvedValue({
        id: 'evt-1',
        taskId: 'task-1',
        category: 'git',
        severity: 'info',
        message: '',
        data: null,
        createdAt: Date.now(),
      } satisfies TaskEvent),
      getEvents: vi.fn().mockResolvedValue([]),
    };

    mockWorktreeManager = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue({ path: '/home/test/project/.agent-worktrees/task-1', branch: 'task/task-1/implement', taskId: 'task-1', locked: false }),
      list: vi.fn(),
      lock: vi.fn(),
      unlock: vi.fn(),
      delete: vi.fn(),
      cleanup: vi.fn(),
    };

    mockGitOps = {
      fetch: vi.fn(),
      rebase: vi.fn(),
      rebaseAbort: vi.fn(),
      diff: vi.fn().mockResolvedValue('diff content here'),
      diffStat: vi.fn(),
      push: vi.fn(),
      pull: vi.fn(),
      commit: vi.fn(),
      log: vi.fn(),
      createBranch: vi.fn(),
      checkout: vi.fn(),
      getCurrentBranch: vi.fn(),
      clean: vi.fn(),
      status: vi.fn(),
      resetFile: vi.fn(),
      showCommit: vi.fn(),
      deleteRemoteBranch: vi.fn(),
      getCommitDetail: vi.fn(),
    };

    mockScmPlatform = {
      createPR: vi.fn().mockResolvedValue({ url: 'https://github.com/owner/repo/pull/42', number: 42, title: 'Test Task' }),
      mergePR: vi.fn(),
      getPRStatus: vi.fn(),
      isPRMergeable: vi.fn().mockResolvedValue(true),
    };

    deps = {
      projectStore: mockProjectStore,
      taskStore: mockTaskStore,
      taskArtifactStore: mockTaskArtifactStore,
      taskEventLog: mockTaskEventLog,
      createWorktreeManager: vi.fn().mockReturnValue(mockWorktreeManager),
      createGitOps: vi.fn().mockReturnValue(mockGitOps),
      createScmPlatform: vi.fn().mockReturnValue(mockScmPlatform),
    };

    registerScmHandler(mockEngine, deps);
  });

  describe('push_and_create_pr hook', () => {
    const branch = 'task/task-1/implement';

    it('aborts rebase on failure and returns error', async () => {
      (mockGitOps.rebase as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('merge conflict'));

      const result = await hooks['push_and_create_pr'](
        makeTask(),
        makeTransition({ from: 'implementing', to: 'pr_ready' }),
        makeContext({ data: { branch } }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Merge conflicts');
      expect(mockGitOps.rebaseAbort).toHaveBeenCalled();
      // Push should NOT be called after rebase failure
      expect(mockGitOps.push).not.toHaveBeenCalled();
    });

    it('skips push when no changes detected', async () => {
      (mockGitOps.diff as ReturnType<typeof vi.fn>).mockResolvedValue('');

      const result = await hooks['push_and_create_pr'](
        makeTask(),
        makeTransition({ from: 'implementing', to: 'pr_ready' }),
        makeContext({ data: { branch } }),
      );

      expect(result.success).toBe(true);
      expect(mockGitOps.push).not.toHaveBeenCalled();
      expect(mockScmPlatform.createPR).not.toHaveBeenCalled();
    });

    it('skips PR creation when PR already exists for same branch', async () => {
      (mockTaskArtifactStore.getArtifactsForTask as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeArtifact({ data: { url: 'https://github.com/owner/repo/pull/10', branch } }),
      ]);

      const result = await hooks['push_and_create_pr'](
        makeTask(),
        makeTransition({ from: 'implementing', to: 'pr_ready' }),
        makeContext({ data: { branch } }),
      );

      expect(result.success).toBe(true);
      expect(mockScmPlatform.createPR).not.toHaveBeenCalled();
    });

    it('creates PR with multi-phase title format', async () => {
      const multiPhaseTask = makeTask({
        phases: [
          {
            id: 'phase-1',
            name: 'Phase 1: Data Model',
            status: 'in_progress',
            subtasks: [
              { id: 'sub-1', name: 'Create schema', status: 'pending' },
              { id: 'sub-2', name: 'Add migration', status: 'pending' },
            ],
          },
          {
            id: 'phase-2',
            name: 'Phase 2: API Layer',
            status: 'pending',
            subtasks: [
              { id: 'sub-3', name: 'Add endpoints', status: 'pending' },
            ],
          },
        ],
      });

      // getTask returns the multi-phase task (for fresh read inside hook)
      (mockTaskStore.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(multiPhaseTask);

      // First call returns empty (for diff artifact), second returns empty (for PR check)
      (mockTaskArtifactStore.getArtifactsForTask as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await hooks['push_and_create_pr'](
        multiPhaseTask,
        makeTransition({ from: 'implementing', to: 'pr_ready' }),
        makeContext({ data: { branch } }),
      );

      expect(result.success).toBe(true);
      expect(mockScmPlatform.createPR).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '[Phase 1/2] Test Task',
        }),
      );
    });

    it('returns error when no branch in transition context', async () => {
      const result = await hooks['push_and_create_pr'](
        makeTask(),
        makeTransition({ from: 'implementing', to: 'pr_ready' }),
        makeContext({ data: {} }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No branch');
    });
  });

  describe('merge_pr hook', () => {
    it('throws when no PR artifact found', async () => {
      (mockTaskArtifactStore.getArtifactsForTask as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await expect(
        hooks['merge_pr'](makeTask(), makeTransition(), makeContext()),
      ).rejects.toThrow('no PR artifact found');
    });

    it('returns failure when PR is not mergeable', async () => {
      (mockTaskArtifactStore.getArtifactsForTask as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeArtifact(),
      ]);
      (mockScmPlatform.isPRMergeable as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const result = await hooks['merge_pr'](makeTask(), makeTransition(), makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('not mergeable');
      // mergePR should NOT be called when not mergeable
      expect(mockScmPlatform.mergePR).not.toHaveBeenCalled();
    });

    it('logs warning when worktree delete fails (non-fatal)', async () => {
      (mockTaskArtifactStore.getArtifactsForTask as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeArtifact(),
      ]);
      (mockWorktreeManager.delete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('worktree remove failed'),
      );

      const result = await hooks['merge_pr'](makeTask(), makeTransition(), makeContext());

      expect(result.success).toBe(true);
      // Should have logged a warning about cleanup failure
      expect(mockTaskEventLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('Worktree cleanup before merge failed'),
        }),
      );
      // mergePR should still be called despite worktree cleanup failure
      expect(mockScmPlatform.mergePR).toHaveBeenCalled();
    });

    it('succeeds on happy path — merge and return success', async () => {
      (mockTaskArtifactStore.getArtifactsForTask as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeArtifact(),
      ]);

      const result = await hooks['merge_pr'](makeTask(), makeTransition(), makeContext());

      expect(result.success).toBe(true);
      expect(mockScmPlatform.mergePR).toHaveBeenCalledWith('https://github.com/owner/repo/pull/42');
    });

    it('fetches main when pullMainAfterMerge is enabled', async () => {
      (mockTaskArtifactStore.getArtifactsForTask as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeArtifact(),
      ]);
      (mockProjectStore.getProject as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'proj-1',
        name: 'Test Project',
        description: null,
        path: '/home/test/project',
        config: { pullMainAfterMerge: true },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies Project);

      const result = await hooks['merge_pr'](makeTask(), makeTransition(), makeContext());

      expect(result.success).toBe(true);
      expect(mockGitOps.fetch).toHaveBeenCalledWith('origin', 'main:main');
    });

    it('succeeds when PR is already merged (isPRMergeable returns true)', async () => {
      (mockTaskArtifactStore.getArtifactsForTask as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeArtifact(),
      ]);
      // Simulate isPRMergeable returning true for an already-merged PR
      (mockScmPlatform.isPRMergeable as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const result = await hooks['merge_pr'](makeTask(), makeTransition(), makeContext());

      expect(result.success).toBe(true);
      expect(mockScmPlatform.isPRMergeable).toHaveBeenCalled();
    });
  });
});
