import type {
  AgentRun,
  AgentMode,
  AgentContext,
  AgentConfig,
  TransitionContext,
} from '../../shared/types';
import type { IAgentFramework } from '../interfaces/agent-framework';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { IGitOps } from '../interfaces/git-ops';
import type { IScmPlatform } from '../interfaces/scm-platform';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskPhaseStore } from '../interfaces/task-phase-store';
import type { IPendingPromptStore } from '../interfaces/pending-prompt-store';
import type { IAgentService } from '../interfaces/agent-service';
import { validateOutcomePayload } from '../handlers/outcome-schemas';
import { now } from '../stores/utils';

export class AgentService implements IAgentService {
  private backgroundPromises = new Map<string, Promise<void>>();

  constructor(
    private agentFramework: IAgentFramework,
    private agentRunStore: IAgentRunStore,
    private createWorktreeManager: (projectPath: string) => IWorktreeManager,
    private createGitOps: (cwd: string) => IGitOps,
    private createScmPlatform: (repoPath: string) => IScmPlatform,
    private taskStore: ITaskStore,
    private projectStore: IProjectStore,
    private pipelineEngine: IPipelineEngine,
    private taskEventLog: ITaskEventLog,
    private taskArtifactStore: ITaskArtifactStore,
    private taskPhaseStore: ITaskPhaseStore,
    private pendingPromptStore: IPendingPromptStore,
  ) {}

  async execute(taskId: string, mode: AgentMode, agentType: string, onOutput?: (chunk: string) => void): Promise<AgentRun> {
    // 1. Fetch task + project
    const task = await this.taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const project = await this.projectStore.getProject(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

    const projectPath = project.path;
    if (!projectPath) throw new Error(`Project ${project.id} has no path configured`);
    const worktreeManager = this.createWorktreeManager(projectPath);
    const gitOps = this.createGitOps(projectPath);
    const scmPlatform = this.createScmPlatform(projectPath);

    // 2. Create agent run record
    const run = await this.agentRunStore.createRun({ taskId, agentType, mode });

    // 3. Manage phase
    let phase = await this.taskPhaseStore.getActivePhase(taskId);
    if (!phase) {
      phase = await this.taskPhaseStore.createPhase({ taskId, phase: mode });
    }
    await this.taskPhaseStore.updatePhase(phase.id, {
      status: 'active',
      agentRunId: run.id,
      startedAt: now(),
    });

    // 4. Prepare environment
    let worktree = await worktreeManager.get(taskId);
    if (!worktree) {
      const branch = `task/${taskId}/${mode}`;
      worktree = await worktreeManager.create(branch, taskId);
    }
    await worktreeManager.lock(taskId);

    // 5. Log event
    await this.taskEventLog.log({
      taskId,
      category: 'agent',
      severity: 'info',
      message: `Agent ${agentType} started in ${mode} mode`,
      data: { agentRunId: run.id, agentType, mode },
    });

    // 6. Build context — agent runs in the worktree, not the main checkout
    const context: AgentContext = {
      task,
      project,
      workdir: worktree.path,
      mode,
    };
    const config: AgentConfig = {};

    // 7. Fire-and-forget agent execution in background
    const agent = this.agentFramework.getAgent(agentType);
    const promise = this.runAgentInBackground(agent, context, config, run, task, phase, worktree, worktreeManager, gitOps, scmPlatform, agentType, onOutput);
    this.backgroundPromises.set(run.id, promise);

    // 8. Return run immediately (status: 'running')
    return run;
  }

  private async runAgentInBackground(
    agent: import('../interfaces/agent').IAgent,
    context: AgentContext,
    config: AgentConfig,
    run: AgentRun,
    task: import('../../shared/types').Task,
    phase: { id: string },
    worktree: { branch: string; path: string },
    worktreeManager: IWorktreeManager,
    gitOps: IGitOps,
    scmPlatform: IScmPlatform,
    agentType: string,
    onOutput?: (chunk: string) => void,
  ): Promise<void> {
    const taskId = task.id;
    try {
      let result;
      try {
        result = await agent.execute(context, config, onOutput);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const completedAt = now();
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          output: errorMsg,
          outcome: 'failed',
          exitCode: 1,
          completedAt,
        });
        await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'error',
          message: `Agent ${agentType} failed: ${errorMsg}`,
          data: { agentRunId: run.id, error: errorMsg },
        });
        await worktreeManager.unlock(taskId);
        return;
      }

      // Update run
      const completedAt = now();
      await this.agentRunStore.updateRun(run.id, {
        status: result.exitCode === 0 ? 'completed' : 'failed',
        output: result.output,
        outcome: result.outcome,
        payload: result.payload,
        exitCode: result.exitCode,
        completedAt,
        costInputTokens: result.costInputTokens,
        costOutputTokens: result.costOutputTokens,
      });

      // Validate outcome payload
      if (result.outcome) {
        const validation = validateOutcomePayload(result.outcome, result.payload);
        if (!validation.valid) {
          await this.taskEventLog.log({
            taskId,
            category: 'agent',
            severity: 'warning',
            message: `Invalid outcome payload: ${validation.error}`,
            data: { outcome: result.outcome, error: validation.error },
          });
          // Don't block — still attempt transition (warn-and-proceed for v1)
        }
      }

      // Handle outcome
      if (result.outcome === 'needs_info') {
        await this.pendingPromptStore.createPrompt({
          taskId,
          agentRunId: run.id,
          promptType: 'needs_info',
          payload: result.payload,
        });
        await this.tryOutcomeTransition(taskId, 'needs_info');
      } else if (result.exitCode === 0) {
        await this.collectArtifacts(taskId, worktree.branch, result, gitOps, scmPlatform);
        await this.taskPhaseStore.updatePhase(phase.id, { status: 'completed', completedAt });
        if (result.outcome) {
          await this.tryOutcomeTransition(taskId, result.outcome);
        }
      } else {
        await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
      }

      // Cleanup
      await worktreeManager.unlock(taskId);

      // Log completion event
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: result.exitCode === 0 ? 'info' : 'error',
        message: `Agent ${agentType} completed with outcome: ${result.outcome ?? 'none'}`,
        data: { agentRunId: run.id, exitCode: result.exitCode, outcome: result.outcome },
      });
    } finally {
      this.backgroundPromises.delete(run.id);
    }
  }

  async waitForCompletion(runId: string): Promise<void> {
    const promise = this.backgroundPromises.get(runId);
    if (promise) {
      await promise;
    }
  }

  async stop(runId: string): Promise<void> {
    const run = await this.agentRunStore.getRun(runId);
    if (!run) throw new Error(`Agent run not found: ${runId}`);

    const agent = this.agentFramework.getAgent(run.agentType);
    await agent.stop(run.taskId);

    await this.agentRunStore.updateRun(runId, {
      status: 'cancelled',
      completedAt: now(),
    });

    await this.pendingPromptStore.expirePromptsForRun(runId);
  }

  private async tryOutcomeTransition(taskId: string, outcome: string): Promise<void> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return;

    const transitions = await this.pipelineEngine.getValidTransitions(task, 'agent');
    const match = transitions.find((t) => t.agentOutcome === outcome);
    if (match) {
      const ctx: TransitionContext = { trigger: 'agent', data: { outcome } };
      await this.pipelineEngine.executeTransition(task, match.to, ctx);
    }
  }

  private async collectArtifacts(
    taskId: string,
    branch: string,
    result: { outcome?: string; payload?: Record<string, unknown> },
    gitOps: IGitOps,
    scmPlatform: IScmPlatform,
  ): Promise<void> {
    // Always create branch artifact
    await this.taskArtifactStore.createArtifact({
      taskId,
      type: 'branch',
      data: { branch },
    });

    if (result.outcome === 'pr_ready') {
      // Create diff artifact
      try {
        const diffContent = await gitOps.diff('main', branch);
        await this.taskArtifactStore.createArtifact({
          taskId,
          type: 'diff',
          data: { diff: diffContent },
        });
      } catch (err) {
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'warning',
          message: `Failed to collect diff: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Push branch to remote, then create PR
      try {
        await gitOps.push(branch);

        const task = await this.taskStore.getTask(taskId);
        const prInfo = await scmPlatform.createPR({
          title: task?.title ?? 'PR',
          body: `Automated PR for task ${taskId}`,
          head: branch,
          base: 'main',
        });

        await this.taskArtifactStore.createArtifact({
          taskId,
          type: 'pr',
          data: { url: prInfo.url, number: prInfo.number },
        });

        // Update task with PR link and branch name
        await this.taskStore.updateTask(taskId, {
          prLink: prInfo.url,
          branchName: branch,
        });
      } catch (err) {
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'error',
          message: `Failed to create PR: ${err instanceof Error ? err.message : String(err)}`,
          data: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  }
}
