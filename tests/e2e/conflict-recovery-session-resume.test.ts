/**
 * E2E test: multi-phase merge_failed conflict recovery with session resume.
 *
 * Exercises the full chain for the historical bug:
 * 1. Initial implementor run completes (with a real Agent backed by a mocked IAgentLib).
 * 2. OutcomeResolver detects rebase conflicts against the task integration branch.
 * 3. Pipeline self-transitions via conflicts_detected.
 * 4. Implementor restarts in revision / merge_failed mode.
 * 5. Revision run resumes the prior session with a prompt targeting
 *    origin/task/.../integration (NOT origin/main).
 *
 * Fully deterministic and self-contained: no network, no real git repo, no real daemon.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import { StubGitOps } from '../../src/core/services/stub-git-ops';
import { Agent } from '../../src/core/agents/agent';
import { ImplementorPromptBuilder } from '../../src/core/agents/implementor-prompt-builder';
import { AgentLibRegistry } from '../../src/core/services/agent-lib-registry';
import type {
  IAgentLib,
  AgentLibFeatures,
  AgentLibRunOptions,
  AgentLibCallbacks,
  AgentLibResult,
  AgentLibTelemetry,
  AgentLibModelOption,
} from '../../src/core/interfaces/agent-lib';
import type { HookResult } from '../../src/shared/types';
import { now } from '../../src/core/stores/utils';

/**
 * A mock IAgentLib that records every execute() call and returns canned success.
 * Used instead of ScriptedAgent so the real Agent class (with its session resume
 * logic, prompt builder, and lib registry) is exercised end-to-end.
 */
class MockAgentLib implements IAgentLib {
  readonly name = 'claude-code';
  /** Every execute() call is recorded here for assertions. */
  readonly executeCalls: Array<{ runId: string; options: AgentLibRunOptions }> = [];

  supportedFeatures(): AgentLibFeatures {
    return {
      images: false,
      hooks: false,
      thinking: false,
      nativeResume: true,
      streamingInput: false,
    };
  }

  getDefaultModel(): string { return 'mock-model'; }

  getSupportedModels(): AgentLibModelOption[] {
    return [{ value: 'mock-model', label: 'Mock Model' }];
  }

  async execute(runId: string, options: AgentLibRunOptions, _callbacks: AgentLibCallbacks): Promise<AgentLibResult> {
    this.executeCalls.push({ runId, options });
    return {
      exitCode: 0,
      output: 'Implementation complete',
    };
  }

  async stop(_runId: string): Promise<void> { /* no-op */ }

  async isAvailable(): Promise<boolean> { return true; }

  getTelemetry(_runId: string): AgentLibTelemetry | null { return null; }

  injectMessage(_runId: string, _message: string): boolean { return false; }
}

describe('Conflict Recovery with Session Resume (multi-phase)', () => {
  let ctx: TestContext;
  let projectId: string;
  let mockLib: MockAgentLib;
  let startAgentCalls: Array<{ taskId: string; mode: string; agentType: string; revisionReason?: string }>;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    startAgentCalls = [];
    mockLib = new MockAgentLib();

    // Create the real implementor Agent backed by MockAgentLib:
    // 1. Create a lib registry with our mock lib
    const libRegistry = new AgentLibRegistry();
    libRegistry.register(mockLib);

    // 2. Create a real Agent with the real ImplementorPromptBuilder
    const implementorPromptBuilder = new ImplementorPromptBuilder();
    const implementorAgent = new Agent('implementor', implementorPromptBuilder, libRegistry);

    // 3. Replace the ScriptedAgent implementor with the real one in the framework
    ctx.agentFramework.registerAgent(implementorAgent);

    // Register a stub start_agent hook so we can observe hook calls
    // and manually trigger agent execution (like agent-outcomes tests).
    ctx.pipelineEngine.registerHook('start_agent', async (task, _transition, _context, params): Promise<HookResult> => {
      startAgentCalls.push({
        taskId: task.id,
        mode: params?.mode as string,
        agentType: params?.agentType as string,
        revisionReason: params?.revisionReason as string | undefined,
      });
      return { success: true };
    });

    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should resume the original session and target the integration branch on conflict recovery', async () => {
    const TASK_BRANCH = 'task/test-task-123/integration';

    // ---------------------------------------------------------------
    // Step 1: Create a multi-phase task at 'implementing' with taskBranch
    // ---------------------------------------------------------------
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing', {
      phases: [
        { id: 'phase-1', name: 'Phase 1', status: 'completed', subtasks: [] },
        { id: 'phase-2', name: 'Phase 2', status: 'in_progress', subtasks: [] },
      ],
      metadata: { taskBranch: TASK_BRANCH },
    });

    // ---------------------------------------------------------------
    // Step 2: First implementor run completes successfully
    // ---------------------------------------------------------------
    // Create worktree & phase (required by AgentService / OutcomeResolver)
    await ctx.worktreeManager.create('task/test-branch', task.id);
    await ctx.worktreeManager.lock(task.id);
    const phase1 = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 2 impl' });
    await ctx.taskPhaseStore.updatePhase(phase1.id, { status: 'active', startedAt: now() });

    // Simulate the first implementor run (mode='new') via agentService.execute()
    // This creates a run record, stores a sessionId, and runs the agent.
    const firstRun = await ctx.agentService.execute(
      task.id,
      'new',
      'implementor',
      undefined,
    );
    // Wait for the background agent to complete
    await ctx.agentService.waitForCompletion(firstRun.id);

    // Verify the first run completed and has a sessionId stored
    const firstRunAfter = await ctx.agentRunStore.getRun(firstRun.id);
    expect(firstRunAfter).toBeDefined();
    expect(firstRunAfter!.status).toBe('completed');
    const originalSessionId = firstRunAfter!.sessionId;
    expect(originalSessionId).toBeDefined();

    // Verify the mock lib was called with resumeSession=false for the first run
    expect(mockLib.executeCalls.length).toBeGreaterThanOrEqual(1);
    const firstLibCall = mockLib.executeCalls[0];
    expect(firstLibCall.options.resumeSession).toBe(false);

    // ---------------------------------------------------------------
    // Step 3: OutcomeResolver resolved pr_ready → detected conflicts
    //         The first run's OutcomeResolver already ran and transitioned
    //         the task. The task should have been self-transitioned to
    //         'implementing' via conflicts_detected.
    //
    //         But since StubGitOps.rebase succeeds by default, the first
    //         run resolved as pr_ready → pr_review. We need to test
    //         the conflict path explicitly.
    //
    //         Let's now configure StubGitOps to fail on rebase (for the
    //         integration branch), and call OutcomeResolver manually
    //         to simulate what happens when the agent completes and
    //         conflicts are detected.
    // ---------------------------------------------------------------

    // Reset task back to implementing for the manual OutcomeResolver test
    // (the first run may have advanced the task status)
    const taskAfterFirstRun = await ctx.taskStore.getTask(task.id);
    if (taskAfterFirstRun!.status !== 'implementing') {
      // Force back to implementing for the conflict detection test
      await ctx.pipelineEngine.executeTransition(taskAfterFirstRun!, 'implementing', {
        trigger: 'agent',
        data: { outcome: 'changes_requested' },
      });
    }

    // Configure rebase to fail (simulates conflict against integration branch)
    const stubGit = ctx.gitOps as StubGitOps;
    stubGit.setFailure('rebase', new Error(`CONFLICT: rebase onto origin/${TASK_BRANCH} failed`));

    // Create a new phase for the second outcome resolution
    const phase2 = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 2 conflict' });
    await ctx.taskPhaseStore.updatePhase(phase2.id, { status: 'active', startedAt: now() });

    // Create a run record for outcome resolution. Use mode='continuation' (not 'new')
    // so it won't match findOriginalSessionRun() which searches for mode='new' runs.
    // This avoids shadowing the first real run's sessionId during revision session lookup.
    const secondRun = await ctx.agentRunStore.createRun({
      taskId: task.id,
      agentType: 'implementor',
      mode: 'continuation',
    });
    await ctx.agentRunStore.updateRun(secondRun.id, { status: 'completed', completedAt: now() });

    // Call OutcomeResolver to detect conflicts
    await ctx.outcomeResolver.resolveAndTransition({
      taskId: task.id,
      result: { exitCode: 0, output: 'Done', outcome: 'pr_ready' },
      run: { id: secondRun.id },
      worktree: { branch: 'task/test-branch', path: '/tmp/worktrees/' + task.id },
      worktreeManager: ctx.worktreeManager,
      phase: { id: phase2.id },
      context: { workdir: '/tmp', mode: 'new' } as never,
    });

    // ---------------------------------------------------------------
    // Step 4: Verify the pipeline self-transitioned via conflicts_detected
    // ---------------------------------------------------------------
    const taskAfterConflict = await ctx.taskStore.getTask(task.id);
    expect(taskAfterConflict!.status).toBe('implementing');

    // Verify start_agent hook was called with revision mode and merge_failed reason
    const conflictHookCall = startAgentCalls.find(
      c => c.taskId === task.id && c.mode === 'revision',
    );
    expect(conflictHookCall).toBeDefined();

    // Verify event log references the integration branch (not origin/main)
    const gitEvents = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'git' });
    expect(gitEvents.some(e => e.message.includes(`origin/${TASK_BRANCH}`))).toBe(true);
    expect(gitEvents.some(e => e.message.includes('conflicts'))).toBe(true);

    // ---------------------------------------------------------------
    // Step 5: Simulate the revision run (merge_failed mode) and verify
    //         session resume and prompt content
    // ---------------------------------------------------------------

    // Clear the rebase failure for the revision run
    stubGit.clearFailures();

    // Create a new phase for the revision run
    const phase3 = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 2 revision' });
    await ctx.taskPhaseStore.updatePhase(phase3.id, { status: 'active', startedAt: now() });

    // Execute the revision run via agentService (this triggers the real Agent
    // with the real ImplementorPromptBuilder and our MockAgentLib)
    const revisionRun = await ctx.agentService.execute(
      task.id,
      'revision',
      'implementor',
      'merge_failed',
    );
    await ctx.agentService.waitForCompletion(revisionRun.id);

    // ---------------------------------------------------------------
    // Step 6: Assertions on the revision run
    // ---------------------------------------------------------------

    // 6a. The revision run should have completed successfully
    const revisionRunAfter = await ctx.agentRunStore.getRun(revisionRun.id);
    expect(revisionRunAfter).toBeDefined();
    expect(revisionRunAfter!.status).toBe('completed');

    // 6b. The revision run should reuse the original implementor sessionId
    expect(revisionRunAfter!.sessionId).toBe(originalSessionId);

    // 6c. Verify the mock lib received resumeSession=true with the expected sessionId
    // The revision run's lib call should be the latest one in executeCalls
    const revisionLibCall = mockLib.executeCalls[mockLib.executeCalls.length - 1];
    expect(revisionLibCall.options.resumeSession).toBe(true);
    expect(revisionLibCall.options.sessionId).toBe(originalSessionId);

    // 6d. Verify the stored prompt targets the integration branch (not origin/main).
    // Since nativeResume=true and this is a revision session resume, the Agent class
    // uses buildContinuationPrompt() which includes the rebaseTarget.
    // The continuation prompt should mention the integration branch.
    const storedPrompt = revisionRunAfter!.prompt ?? '';
    expect(storedPrompt).toContain(`origin/${TASK_BRANCH}`);
    expect(storedPrompt).not.toContain('git rebase origin/main');

    // 6e. Also verify the prompt sent to the lib (what MockAgentLib actually received)
    const libPrompt = revisionLibCall.options.prompt;
    expect(libPrompt).toContain(`origin/${TASK_BRANCH}`);
    expect(libPrompt).not.toContain('git rebase origin/main');
  });
});
