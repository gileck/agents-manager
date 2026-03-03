import { describe, it, expect, vi } from 'vitest';
import { ValidationRunner } from '../../src/core/services/validation-runner';
import type { ExecCommandFn } from '../../src/core/services/validation-runner';
import type { AgentRunResult, AgentContext, AgentConfig, AgentChatMessage } from '../../src/shared/types';
import type { IAgentRunStore } from '../../src/core/interfaces/agent-run-store';
import type { ITaskEventLog } from '../../src/core/interfaces/task-event-log';
import type { IAgent } from '../../src/core/interfaces/agent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    task: {
      id: 'task-1', projectId: 'proj-1', pipelineId: 'pipe-1',
      title: 'Test', description: null, debugInfo: null, status: 'implementing',
      priority: 0, tags: [], parentTaskId: null, featureId: null,
      assignee: null, prLink: null, branchName: null, plan: null,
      technicalDesign: null, subtasks: [], phases: null,
      planComments: [], technicalDesignComments: [],
      metadata: {}, createdAt: Date.now(), updatedAt: Date.now(),
    },
    mode: 'new',
    workdir: '/tmp/worktree',
    project: {
      id: 'proj-1', name: 'P', path: '/tmp/main', description: null,
      config: {}, createdAt: Date.now(), updatedAt: Date.now(),
    },
    ...overrides,
  };
}

/** Fresh pass result — always return a new object to avoid cross-test mutation. */
function makePassResult(): AgentRunResult {
  return { exitCode: 0, output: 'done', outcome: 'completed' };
}

function makeExecMock(behaviour: Record<string, Record<string, 'pass' | 'fail'>>): ExecCommandFn {
  return async (cmd, opts) => {
    const cwd = opts.cwd;
    const action = behaviour[cwd]?.[cmd];
    if (action === 'fail') {
      const err = new Error('command failed') as Error & { code: number; stdout: string; stderr: string };
      err.code = 1;
      err.stdout = '';
      err.stderr = `${cmd} failed in ${cwd}`;
      throw err;
    }
    return { stdout: '', stderr: '' };
  };
}

function stubRunStore(): IAgentRunStore {
  return {
    getRun: vi.fn().mockResolvedValue({ id: 'run-1', taskId: 'task-1' }),
  } as unknown as IAgentRunStore;
}

function stubEventLog(): ITaskEventLog {
  return { log: vi.fn().mockResolvedValue(undefined) } as unknown as ITaskEventLog;
}

function stubAgent(makeResults: () => AgentRunResult[] = () => [makePassResult()]): IAgent {
  const results = makeResults();
  let callIndex = 0;
  return {
    execute: vi.fn(async () => ({ ...results[Math.min(callIndex++, results.length - 1)] })),
  } as unknown as IAgent;
}

function baseParams(overrides?: Record<string, unknown>) {
  return {
    agent: stubAgent(),
    context: createContext(),
    config: {} as AgentConfig,
    run: { id: 'run-1', taskId: 'task-1' },
    taskId: 'task-1',
    validationCommands: ['yarn checks', 'yarn test:e2e'],
    maxRetries: 3,
    initialResult: makePassResult(),
    wrappedOnOutput: undefined,
    onLog: vi.fn(),
    onPromptBuilt: vi.fn(),
    wrappedOnMessage: vi.fn() as (msg: AgentChatMessage) => void,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ValidationRunner', () => {
  describe('runValidationPerCommand', () => {
    it('returns per-command pass/fail results', async () => {
      const exec = makeExecMock({
        '/tmp/worktree': { 'yarn checks': 'pass', 'yarn test:e2e': 'fail' },
      });
      const runner = new ValidationRunner(stubRunStore(), stubEventLog(), exec);
      const results = await runner.runValidationPerCommand(['yarn checks', 'yarn test:e2e'], '/tmp/worktree');
      expect(results).toHaveLength(2);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
      expect(results[1].output).toContain('yarn test:e2e');
    });
  });

  describe('runWithRetries — main comparison', () => {
    it('all commands pass — no main comparison, returns pass', async () => {
      const exec = makeExecMock({
        '/tmp/worktree': { 'yarn checks': 'pass', 'yarn test:e2e': 'pass' },
      });
      const runner = new ValidationRunner(stubRunStore(), stubEventLog(), exec);
      const params = baseParams({ projectPath: '/tmp/main' });
      const result = await runner.runWithRetries(params);
      expect(result.exitCode).toBe(0);
    });

    it('all failures are pre-existing (also fail on main) — treated as pass', async () => {
      const exec = makeExecMock({
        '/tmp/worktree': { 'yarn checks': 'fail', 'yarn test:e2e': 'fail' },
        '/tmp/main': { 'yarn checks': 'fail', 'yarn test:e2e': 'fail' },
      });
      const runner = new ValidationRunner(stubRunStore(), stubEventLog(), exec);
      const agent = stubAgent();
      const params = baseParams({ agent, projectPath: '/tmp/main' });
      const result = await runner.runWithRetries(params);
      expect(result.exitCode).toBe(0);
      // Agent should NOT be re-invoked
      expect(agent.execute).not.toHaveBeenCalled();
    });

    it('mix of new + pre-existing — only new failures in context.validationErrors', async () => {
      // First run on worktree: both fail. Main: only checks fails (pre-existing).
      // So test:e2e is a new failure — agent should be retried with only that error.
      // After agent retry, make everything pass so validation succeeds.
      let worktreeCallCount = 0;
      const exec: ExecCommandFn = async (cmd, opts) => {
        const cwd = opts.cwd;
        if (cwd === '/tmp/main') {
          if (cmd === 'yarn checks') {
            const e = new Error() as Error & { code: number; stdout: string; stderr: string };
            e.code = 1; e.stdout = ''; e.stderr = 'checks fail on main';
            throw e;
          }
          return { stdout: '', stderr: '' };
        }
        // Worktree
        worktreeCallCount++;
        if (worktreeCallCount <= 2) {
          // First call: both commands fail
          if (cmd === 'yarn checks' || cmd === 'yarn test:e2e') {
            const e = new Error() as Error & { code: number; stdout: string; stderr: string };
            e.code = 1; e.stdout = ''; e.stderr = `${cmd} fail worktree`;
            throw e;
          }
        }
        return { stdout: '', stderr: '' };
      };

      const runner = new ValidationRunner(stubRunStore(), stubEventLog(), exec);
      const agent = stubAgent();
      const context = createContext();
      const params = baseParams({ agent, context, projectPath: '/tmp/main' });

      await runner.runWithRetries(params);

      // Agent should have been called once for the retry
      expect(agent.execute).toHaveBeenCalledTimes(1);
      // context.validationErrors should only have the new failure (test:e2e)
      expect(context.validationErrors).toContain('yarn test:e2e');
      expect(context.validationErrors).not.toContain('yarn checks');
    });

    it('all failures are new — full errors reported to agent', async () => {
      // Worktree: both fail. Main: both pass. So all are new.
      let worktreeCallCount = 0;
      const exec: ExecCommandFn = async (cmd, opts) => {
        if (opts.cwd === '/tmp/main') return { stdout: '', stderr: '' };
        worktreeCallCount++;
        if (worktreeCallCount <= 2) {
          const e = new Error() as Error & { code: number; stdout: string; stderr: string };
          e.code = 1; e.stdout = ''; e.stderr = `${cmd} fail`;
          throw e;
        }
        return { stdout: '', stderr: '' };
      };

      const runner = new ValidationRunner(stubRunStore(), stubEventLog(), exec);
      const agent = stubAgent();
      const context = createContext();
      const params = baseParams({ agent, context, projectPath: '/tmp/main' });

      await runner.runWithRetries(params);

      expect(agent.execute).toHaveBeenCalledTimes(1);
      expect(context.validationErrors).toContain('yarn checks');
      expect(context.validationErrors).toContain('yarn test:e2e');
    });

    it('retries exhausted with new failures — forces exitCode=1 and outcome=failed', async () => {
      // Always fail on worktree, pass on main → always new failure
      const exec = makeExecMock({
        '/tmp/worktree': { 'yarn checks': 'fail' },
        '/tmp/main': { 'yarn checks': 'pass' },
      });
      const runner = new ValidationRunner(stubRunStore(), stubEventLog(), exec);
      const agent = stubAgent(() => [makePassResult(), makePassResult(), makePassResult()]);
      const params = baseParams({
        agent,
        validationCommands: ['yarn checks'],
        maxRetries: 3,
        projectPath: '/tmp/main',
      });

      const result = await runner.runWithRetries(params);

      expect(result.exitCode).toBe(1);
      expect(result.outcome).toBe('failed');
    });

    it('retries exhausted but only pre-existing failures remain — treated as pass', async () => {
      // First call: new + pre-existing failures. Agent retries fix the new one.
      // After retries, only pre-existing remains.
      let worktreeCallNum = 0;
      const exec: ExecCommandFn = async (cmd, opts) => {
        if (opts.cwd === '/tmp/main') {
          // checks always fails on main (pre-existing)
          if (cmd === 'yarn checks') {
            const e = new Error() as Error & { code: number; stdout: string; stderr: string };
            e.code = 1; e.stdout = ''; e.stderr = 'checks fail main';
            throw e;
          }
          return { stdout: '', stderr: '' };
        }
        // Worktree
        worktreeCallNum++;
        if (cmd === 'yarn checks') {
          // Always fails (pre-existing)
          const e = new Error() as Error & { code: number; stdout: string; stderr: string };
          e.code = 1; e.stdout = ''; e.stderr = 'checks fail worktree';
          throw e;
        }
        if (cmd === 'yarn test:e2e') {
          // Fails first 4 worktree calls, passes after that
          if (worktreeCallNum <= 4) {
            const e = new Error() as Error & { code: number; stdout: string; stderr: string };
            e.code = 1; e.stdout = ''; e.stderr = 'e2e fail worktree';
            throw e;
          }
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      };

      const runner = new ValidationRunner(stubRunStore(), stubEventLog(), exec);
      const agent = stubAgent(() => [makePassResult(), makePassResult(), makePassResult()]);
      const params = baseParams({
        agent,
        maxRetries: 3,
        projectPath: '/tmp/main',
      });

      const result = await runner.runWithRetries(params);

      // Should pass because the only remaining failure (checks) is pre-existing
      expect(result.exitCode).toBe(0);
    });

    it('main comparison throws — fallback to treating all as new', async () => {
      let callNum = 0;
      const exec: ExecCommandFn = async (cmd, _opts) => {
        callNum++;
        if (callNum <= 2) {
          const e = new Error() as Error & { code: number; stdout: string; stderr: string };
          e.code = 1; e.stdout = ''; e.stderr = `${cmd} fail`;
          throw e;
        }
        return { stdout: '', stderr: '' };
      };

      const runner = new ValidationRunner(stubRunStore(), stubEventLog(), exec);
      // Spy on runValidationPerCommand to throw when called with the main path
      const origMethod = runner.runValidationPerCommand.bind(runner);
      vi.spyOn(runner, 'runValidationPerCommand').mockImplementation(async (cmds, cwd) => {
        if (cwd === '/tmp/main') throw new Error('main checkout is broken');
        return origMethod(cmds, cwd);
      });

      const agent = stubAgent();
      const context = createContext();
      const params = baseParams({ agent, context, projectPath: '/tmp/main' });
      const onLog = params.onLog as ReturnType<typeof vi.fn>;

      await runner.runWithRetries(params);

      // Should still retry the agent (all treated as new)
      expect(agent.execute).toHaveBeenCalledTimes(1);
      // Should log the main comparison failure
      expect(onLog).toHaveBeenCalledWith(
        expect.stringContaining('Main comparison failed'),
      );
    });

    it('no projectPath provided — no main comparison, current behavior', async () => {
      let callNum = 0;
      const exec: ExecCommandFn = async (cmd, _opts) => {
        callNum++;
        if (callNum <= 2) {
          const e = new Error() as Error & { code: number; stdout: string; stderr: string };
          e.code = 1; e.stdout = ''; e.stderr = `${cmd} fail`;
          throw e;
        }
        return { stdout: '', stderr: '' };
      };

      const runner = new ValidationRunner(stubRunStore(), stubEventLog(), exec);
      const agent = stubAgent();
      const context = createContext();
      // No projectPath
      const params = baseParams({ agent, context });

      await runner.runWithRetries(params);

      // Should retry agent with all failures (no filtering)
      expect(agent.execute).toHaveBeenCalledTimes(1);
      expect(context.validationErrors).toContain('yarn checks');
      expect(context.validationErrors).toContain('yarn test:e2e');
    });
  });
});
