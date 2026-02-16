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
import { now } from '../stores/utils';

export class AgentService implements IAgentService {
  constructor(
    private agentFramework: IAgentFramework,
    private agentRunStore: IAgentRunStore,
    private worktreeManager: IWorktreeManager,
    private gitOps: IGitOps,
    private scmPlatform: IScmPlatform,
    private taskStore: ITaskStore,
    private projectStore: IProjectStore,
    private pipelineEngine: IPipelineEngine,
    private taskEventLog: ITaskEventLog,
    private taskArtifactStore: ITaskArtifactStore,
    private taskPhaseStore: ITaskPhaseStore,
    private pendingPromptStore: IPendingPromptStore,
  ) {}

  async execute(taskId: string, mode: AgentMode, agentType: string): Promise<AgentRun> {
    // 1. Fetch task + project
    const task = await this.taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const project = await this.projectStore.getProject(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

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
    let worktree = await this.worktreeManager.get(taskId);
    if (!worktree) {
      const branch = `task/${taskId}/${mode}`;
      worktree = await this.worktreeManager.create(branch, taskId);
    }
    await this.worktreeManager.lock(taskId);

    // 5. Log event
    await this.taskEventLog.log({
      taskId,
      category: 'agent',
      severity: 'info',
      message: `Agent ${agentType} started in ${mode} mode`,
      data: { agentRunId: run.id, agentType, mode },
    });

    // 6. Build context
    const context: AgentContext = {
      task,
      project,
      workdir: worktree.path,
      mode,
    };
    const config: AgentConfig = {};

    // 7. Execute agent
    const agent = this.agentFramework.getAgent(agentType);
    let result;
    try {
      result = await agent.execute(context, config);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Update run as failed
      const completedAt = now();
      const updatedRun = await this.agentRunStore.updateRun(run.id, {
        status: 'failed',
        output: errorMsg,
        outcome: 'failed',
        exitCode: 1,
        completedAt,
      });

      // Update phase to failed
      await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });

      // Log error event
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'error',
        message: `Agent ${agentType} failed: ${errorMsg}`,
        data: { agentRunId: run.id, error: errorMsg },
      });

      // Cleanup
      await this.worktreeManager.unlock(taskId);

      return updatedRun!;
    }

    // 8. Update run
    const completedAt = now();
    const updatedRun = await this.agentRunStore.updateRun(run.id, {
      status: result.exitCode === 0 ? 'completed' : 'failed',
      output: result.output,
      outcome: result.outcome,
      payload: result.payload,
      exitCode: result.exitCode,
      completedAt,
      costInputTokens: result.costInputTokens,
      costOutputTokens: result.costOutputTokens,
    });

    // 9. Handle outcome
    if (result.outcome === 'needs_info') {
      // Create pending prompt
      await this.pendingPromptStore.createPrompt({
        taskId,
        agentRunId: run.id,
        promptType: 'needs_info',
        payload: result.payload,
      });
      // Try needs_info transition
      await this.tryOutcomeTransition(taskId, 'needs_info');
    } else if (result.exitCode === 0) {
      // Collect artifacts
      await this.collectArtifacts(taskId, worktree.branch, result);

      // Update phase to completed
      await this.taskPhaseStore.updatePhase(phase.id, { status: 'completed', completedAt });

      // Try outcome transition
      if (result.outcome) {
        await this.tryOutcomeTransition(taskId, result.outcome);
      }
    } else {
      // Failure
      await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
    }

    // 10. Cleanup
    await this.worktreeManager.unlock(taskId);

    // Log completion event
    await this.taskEventLog.log({
      taskId,
      category: 'agent',
      severity: result.exitCode === 0 ? 'info' : 'error',
      message: `Agent ${agentType} completed with outcome: ${result.outcome ?? 'none'}`,
      data: { agentRunId: run.id, exitCode: result.exitCode, outcome: result.outcome },
    });

    return updatedRun!;
  }

  async stop(runId: string): Promise<void> {
    const run = await this.agentRunStore.getRun(runId);
    if (!run) throw new Error(`Agent run not found: ${runId}`);

    const agent = this.agentFramework.getAgent(run.agentType);
    await agent.stop(runId);

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

  private async collectArtifacts(taskId: string, branch: string, result: { outcome?: string; payload?: Record<string, unknown> }): Promise<void> {
    // Always create branch artifact
    await this.taskArtifactStore.createArtifact({
      taskId,
      type: 'branch',
      data: { branch },
    });

    if (result.outcome === 'pr_ready') {
      // Create diff artifact
      try {
        const diffContent = await this.gitOps.diff('main', branch);
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

      // Create PR
      try {
        const task = await this.taskStore.getTask(taskId);
        const prInfo = await this.scmPlatform.createPR({
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
