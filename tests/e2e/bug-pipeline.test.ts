import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, resetCounters } from '../helpers/factories';
import { BUG_AGENT_PIPELINE } from '../../src/main/data/seeded-pipelines';
import type { HookResult } from '../../src/shared/types';

describe('BUG_AGENT_PIPELINE E2E', () => {
  let ctx: TestContext;
  let projectId: string;
  let startAgentCalls: Array<{ taskId: string; mode: string; agentType: string }>;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    startAgentCalls = [];

    // Register stub start_agent hook to track calls without running agents
    ctx.pipelineEngine.registerHook('start_agent', async (task, _transition, _context, params): Promise<HookResult> => {
      startAgentCalls.push({
        taskId: task.id,
        mode: params?.mode as string,
        agentType: params?.agentType as string,
      });
      return { success: true };
    });

    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should transition through full investigation → design → implement → merge path', async () => {
    // Start at reported
    const task = await ctx.createTaskAtStatus(projectId, BUG_AGENT_PIPELINE.id, 'reported');

    // reported → investigating (manual, starts investigate agent)
    let current = await ctx.transitionTo(task.id, 'investigating');
    expect(current.status).toBe('investigating');
    expect(startAgentCalls.some((c) => c.mode === 'new' && c.agentType === 'investigator')).toBe(true);

    // investigating → investigation_review (agent outcome)
    current = (await ctx.pipelineEngine.executeTransition(current, 'investigation_review', {
      trigger: 'agent',
      agentOutcome: 'investigation_complete',
    })).task!;
    expect(current.status).toBe('investigation_review');

    // investigation_review → designing (manual, starts tech design agent)
    current = await ctx.transitionTo(current.id, 'designing');
    expect(current.status).toBe('designing');
    expect(startAgentCalls.some((c) => c.mode === 'new' && c.agentType === 'designer')).toBe(true);

    // designing → design_review (agent outcome)
    current = (await ctx.pipelineEngine.executeTransition(current, 'design_review', {
      trigger: 'agent',
      agentOutcome: 'design_ready',
    })).task!;
    expect(current.status).toBe('design_review');

    // design_review → implementing (manual, starts implement agent)
    current = await ctx.transitionTo(current.id, 'implementing');
    expect(current.status).toBe('implementing');
    expect(startAgentCalls.some((c) => c.mode === 'new' && c.agentType === 'implementor')).toBe(true);

    // Verify transition history covers the full path
    const history = ctx.getTransitionHistory(task.id);
    const statuses = history.map((h) => h.to_status);
    expect(statuses).toEqual([
      'investigating',
      'investigation_review',
      'designing',
      'design_review',
      'implementing',
    ]);
  });

  it('should support investigation_review → request changes → re-investigate', async () => {
    const task = await ctx.createTaskAtStatus(projectId, BUG_AGENT_PIPELINE.id, 'investigation_review');

    // investigation_review → investigating (request changes)
    const current = await ctx.transitionTo(task.id, 'investigating');
    expect(current.status).toBe('investigating');
    expect(startAgentCalls.some((c) => c.mode === 'new' && c.agentType === 'investigator')).toBe(true);
  });

  it('should support needs_info from investigating', async () => {
    const task = await ctx.createTaskAtStatus(projectId, BUG_AGENT_PIPELINE.id, 'investigating');

    // Create an agent run (create_prompt hook requires agentRunId in context)
    const run = await ctx.agentRunStore.createRun({
      taskId: task.id,
      agentType: 'scripted',
      mode: 'new',
    });

    // investigating → needs_info (agent outcome)
    const result = await ctx.pipelineEngine.executeTransition(task, 'needs_info', {
      trigger: 'agent',
      agentOutcome: 'needs_info',
      data: { agentRunId: run.id },
    });
    expect(result.success).toBe(true);
    expect(result.task!.status).toBe('needs_info');

    // Verify a pending prompt was created
    const prompts = await ctx.pendingPromptStore.getPendingForTask(task.id);
    expect(prompts.length).toBe(1);
    expect(prompts[0].resumeOutcome).toBe('info_provided');
  });

  it('should resume from needs_info back to investigating', async () => {
    const task = await ctx.createTaskAtStatus(projectId, BUG_AGENT_PIPELINE.id, 'investigating');

    // Create an agent run for the needs_info transition
    const run = await ctx.agentRunStore.createRun({
      taskId: task.id,
      agentType: 'scripted',
      mode: 'new',
    });

    // investigating → needs_info
    const needsInfoResult = await ctx.pipelineEngine.executeTransition(task, 'needs_info', {
      trigger: 'agent',
      agentOutcome: 'needs_info',
      data: { agentRunId: run.id },
    });
    const needsInfoTask = needsInfoResult.task!;

    // needs_info → investigating (info_provided resume)
    const resumeResult = await ctx.pipelineEngine.executeTransition(needsInfoTask, 'investigating', {
      trigger: 'agent',
      agentOutcome: 'info_provided',
    });
    expect(resumeResult.success).toBe(true);
    expect(resumeResult.task!.status).toBe('investigating');
    expect(startAgentCalls.some((c) => c.mode === 'revision' && c.agentType === 'investigator')).toBe(true);
  });

  it('should support direct reported → implementing skip path', async () => {
    const task = await ctx.createTaskAtStatus(projectId, BUG_AGENT_PIPELINE.id, 'reported');

    const current = await ctx.transitionTo(task.id, 'implementing');
    expect(current.status).toBe('implementing');
    expect(startAgentCalls.some((c) => c.mode === 'new' && c.agentType === 'implementor')).toBe(true);
  });

  it('should support cancel investigation back to reported', async () => {
    const task = await ctx.createTaskAtStatus(projectId, BUG_AGENT_PIPELINE.id, 'investigating');

    const current = await ctx.transitionTo(task.id, 'reported');
    expect(current.status).toBe('reported');
  });
});
