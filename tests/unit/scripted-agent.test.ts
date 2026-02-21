import { describe, it, expect } from 'vitest';
import {
  ScriptedAgent,
  happyPlan,
  happyImplement,
  happyReview,
  humanInTheLoop,
  failAfterSteps,
} from '../../src/main/agents/scripted-agent';
import type { AgentContext, AgentConfig } from '../../src/shared/types';

function createContext(): AgentContext {
  return {
    task: {
      id: 'task-1',
      projectId: 'proj-1',
      pipelineId: 'pipe-1',
      title: 'Test task',
      description: null,
      status: 'planning',
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
      planComments: [],
      technicalDesignComments: [],
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    mode: 'plan',
    workdir: '/tmp/test',
    project: { id: 'proj-1', name: 'Test Project', path: '/tmp/test', description: null, config: {}, createdAt: Date.now(), updatedAt: Date.now() },
  };
}

const defaultConfig: AgentConfig = {};

describe('preset scripts', () => {
  describe('happyPlan', () => {
    it('returns exitCode 0 with plan_complete outcome', async () => {
      const result = await happyPlan(createContext(), defaultConfig);

      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('plan_complete');
      expect(result.output).toContain('Plan generated');
      expect(result.payload).toBeDefined();
      expect(result.payload!.plan).toEqual(['step1', 'step2', 'step3']);
    });
  });

  describe('happyImplement', () => {
    it('returns exitCode 0 with pr_ready outcome', async () => {
      const result = await happyImplement(createContext(), defaultConfig);

      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('pr_ready');
      expect(result.output).toContain('Implementation complete');
      expect(result.payload).toBeDefined();
      expect(result.payload!.filesChanged).toBe(3);
    });
  });

  describe('happyReview', () => {
    it('returns exitCode 0 with approved outcome', async () => {
      const result = await happyReview(createContext(), defaultConfig);

      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('approved');
      expect(result.output).toContain('Review approved');
      expect(result.payload).toBeUndefined();
    });
  });

  describe('humanInTheLoop', () => {
    it('returns exitCode 0 with needs_info outcome and questions', async () => {
      const result = await humanInTheLoop(createContext(), defaultConfig);

      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('needs_info');
      expect(result.output).toContain('Need more information');
      expect(result.payload).toBeDefined();
      expect(result.payload!.questions).toHaveLength(2);
    });
  });
});

describe('failAfterSteps', () => {
  it('first 2 calls succeed and 3rd call fails with failAfterSteps(3)', async () => {
    const script = failAfterSteps(3);
    const ctx = createContext();

    const result1 = await script(ctx, defaultConfig);
    expect(result1.exitCode).toBe(0);
    expect(result1.outcome).toBe('step_complete');

    const result2 = await script(ctx, defaultConfig);
    expect(result2.exitCode).toBe(0);
    expect(result2.outcome).toBe('step_complete');

    const result3 = await script(ctx, defaultConfig);
    expect(result3.exitCode).toBe(1);
    expect(result3.outcome).toBe('failed');
    expect(result3.error).toContain('Simulated failure after 3 steps');
  });

  it('first call fails with failAfterSteps(1)', async () => {
    const script = failAfterSteps(1);
    const ctx = createContext();

    const result = await script(ctx, defaultConfig);
    expect(result.exitCode).toBe(1);
    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('Simulated failure after 1 steps');
  });

  it('each failAfterSteps call creates an independent counter', async () => {
    const script1 = failAfterSteps(2);
    const script2 = failAfterSteps(2);
    const ctx = createContext();

    // Advance script1 to step 1
    const r1 = await script1(ctx, defaultConfig);
    expect(r1.exitCode).toBe(0);

    // script2 should still be on its own step 1
    const r2 = await script2(ctx, defaultConfig);
    expect(r2.exitCode).toBe(0);

    // script1 step 2 should fail
    const r3 = await script1(ctx, defaultConfig);
    expect(r3.exitCode).toBe(1);

    // script2 step 2 should also fail (independently)
    const r4 = await script2(ctx, defaultConfig);
    expect(r4.exitCode).toBe(1);
  });
});

describe('ScriptedAgent', () => {
  describe('constructor and type', () => {
    it('uses default type "scripted" when not specified', () => {
      const agent = new ScriptedAgent(happyPlan);
      expect(agent.type).toBe('scripted');
    });

    it('uses custom type when provided', () => {
      const agent = new ScriptedAgent(happyPlan, 'custom-planner');
      expect(agent.type).toBe('custom-planner');
    });
  });

  describe('execute', () => {
    it('executes the default script', async () => {
      const agent = new ScriptedAgent(happyPlan);

      const result = await agent.execute(createContext(), defaultConfig);

      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('plan_complete');
    });

    it('passes context and config to the script', async () => {
      const customScript = vi.fn().mockResolvedValue({
        exitCode: 0,
        output: 'custom',
        outcome: 'done',
      });
      const agent = new ScriptedAgent(customScript);
      const ctx = createContext();
      const cfg: AgentConfig = { timeout: 5000 };

      await agent.execute(ctx, cfg);

      expect(customScript).toHaveBeenCalledWith(ctx, cfg);
    });
  });

  describe('setScript', () => {
    it('changes behavior on next execute', async () => {
      const agent = new ScriptedAgent(happyPlan);

      // First execution uses happyPlan
      const result1 = await agent.execute(createContext(), defaultConfig);
      expect(result1.outcome).toBe('plan_complete');

      // Change script to happyImplement
      agent.setScript(happyImplement);

      // Second execution uses happyImplement
      const result2 = await agent.execute(createContext(), defaultConfig);
      expect(result2.outcome).toBe('pr_ready');
    });
  });

  describe('stop', () => {
    it('resolves without error', async () => {
      const agent = new ScriptedAgent(happyPlan);

      await expect(agent.stop('run-1')).resolves.toBeUndefined();
    });
  });

  describe('isAvailable', () => {
    it('returns true', async () => {
      const agent = new ScriptedAgent(happyPlan);

      const available = await agent.isAvailable();

      expect(available).toBe(true);
    });
  });
});
