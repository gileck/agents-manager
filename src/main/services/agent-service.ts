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
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'info',
        message: `Worktree created on branch ${branch}`,
        data: { branch, path: worktree.path, taskId },
      });
    } else {
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'info',
        message: `Worktree reused at ${worktree.path}`,
        data: { path: worktree.path },
      });
    }
    await worktreeManager.lock(taskId);
    await this.taskEventLog.log({
      taskId,
      category: 'worktree',
      severity: 'debug',
      message: 'Worktree locked',
      data: { taskId },
    });

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
    const promise = this.runAgentInBackground(agent, context, config, run, task, phase, worktree, worktreeManager, agentType, onOutput);
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
    agentType: string,
    onOutput?: (chunk: string) => void,
  ): Promise<void> {
    const taskId = task.id;
    const onLog = (message: string, data?: Record<string, unknown>) => {
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message,
        data,
      }).catch(() => {}); // fire-and-forget
    };
    try {
      let result;
      try {
        result = await agent.execute(context, config, onOutput, onLog);
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
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'debug',
          message: 'Worktree unlocked',
          data: { taskId },
        });
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

      // Handle outcome — all outcomes go through the generic transition path.
      // Side-effects (prompt creation, PR creation) are handled by hooks on the transition.
      if (result.exitCode === 0) {
        // Always create branch artifact for successful runs
        await this.taskArtifactStore.createArtifact({
          taskId,
          type: 'branch',
          data: { branch: worktree.branch },
        });
        await this.taskPhaseStore.updatePhase(phase.id, { status: 'completed', completedAt });

        // For pr_ready: verify there are actual commits before transitioning
        let effectiveOutcome: string | undefined = result.outcome;
        if (effectiveOutcome === 'pr_ready' && context.project?.path) {
          try {
            const gitOps = this.createGitOps(context.project.path);
            const diffContent = await gitOps.diff('main', worktree.branch);
            if (diffContent.trim().length === 0) {
              await this.taskEventLog.log({
                taskId,
                category: 'agent',
                severity: 'warning',
                message: 'Agent reported pr_ready but no changes detected on branch — skipping transition',
                data: { branch: worktree.branch },
              });
              effectiveOutcome = undefined;
            }
          } catch (err) {
            await this.taskEventLog.log({
              taskId,
              category: 'agent',
              severity: 'warning',
              message: `Failed to verify branch diff: ${err instanceof Error ? err.message : String(err)}`,
              data: { branch: worktree.branch },
            });
          }
        }

        if (effectiveOutcome) {
          await this.tryOutcomeTransition(taskId, effectiveOutcome, {
            agentRunId: run.id,
            payload: result.payload,
            branch: worktree.branch,
          });
        }
      } else {
        await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
      }

      // Cleanup
      await worktreeManager.unlock(taskId);
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'debug',
        message: 'Worktree unlocked',
        data: { taskId },
      });

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

  private async tryOutcomeTransition(taskId: string, outcome: string, data?: Record<string, unknown>): Promise<void> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return;

    const transitions = await this.pipelineEngine.getValidTransitions(task, 'agent');
    const match = transitions.find((t) => t.agentOutcome === outcome);
    if (match) {
      const ctx: TransitionContext = { trigger: 'agent', data: { outcome, ...data } };
      await this.pipelineEngine.executeTransition(task, match.to, ctx);
    }
  }

}
