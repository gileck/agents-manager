import type { AgentRunResult, AgentContext, TransitionContext } from '../../shared/types';
import type { IGitOps } from '../interfaces/git-ops';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskPhaseStore } from '../interfaces/task-phase-store';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import { now } from '../stores/utils';

export class OutcomeResolver {
  constructor(
    private createGitOps: (cwd: string) => IGitOps,
    private pipelineEngine: IPipelineEngine,
    private taskStore: ITaskStore,
    private taskPhaseStore: ITaskPhaseStore,
    private taskArtifactStore: ITaskArtifactStore,
    private taskEventLog: ITaskEventLog,
  ) {}

  async resolveAndTransition(params: {
    taskId: string;
    result: AgentRunResult;
    run: { id: string };
    worktree: { branch: string; path: string };
    worktreeManager: IWorktreeManager;
    phase: { id: string };
    context: AgentContext;
  }): Promise<void> {
    const { taskId, result, run, worktree, worktreeManager, phase, context } = params;
    const completedAt = now();

    if (result.exitCode === 0) {
      // Always create branch artifact for successful runs
      await this.taskArtifactStore.createArtifact({
        taskId,
        type: 'branch',
        data: { branch: worktree.branch },
      });
      await this.taskPhaseStore.updatePhase(phase.id, { status: 'completed', completedAt });

      let effectiveOutcome = result.outcome;

      if (effectiveOutcome === 'pr_ready') {
        effectiveOutcome = await this.verifyBranchDiff(taskId, worktree);
      }

      // Early conflict detection (skip for resolve_conflicts mode)
      if (effectiveOutcome === 'pr_ready' && context.mode !== 'resolve_conflicts') {
        effectiveOutcome = await this.detectConflicts(taskId, worktree);
      }

      if (effectiveOutcome) {
        this.taskEventLog.log({
          taskId,
          category: 'agent_debug',
          severity: 'debug',
          message: `Attempting outcome transition: outcome=${effectiveOutcome}`,
        }).catch(() => {});
        await this.tryOutcomeTransition(taskId, effectiveOutcome, {
          agentRunId: run.id,
          payload: result.payload,
          branch: worktree.branch,
        });
      }
    } else {
      await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
    }

    // Cleanup — unlock before retry transition so the new agent can acquire the lock.
    try {
      await worktreeManager.unlock(taskId);
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'debug',
        message: 'Worktree unlocked',
        data: { taskId },
      });
    } catch {
      // Worktree may have been deleted by a transition hook — safe to ignore
    }

    // For failed runs, attempt failure transition (pipeline may retry via hooks)
    if (result.exitCode !== 0) {
      await this.tryOutcomeTransition(taskId, 'failed', { agentRunId: run.id });
    }
  }

  private async verifyBranchDiff(taskId: string, worktree: { branch: string; path: string }): Promise<'pr_ready' | 'no_changes'> {
    this.taskEventLog.log({
      taskId,
      category: 'agent_debug',
      severity: 'debug',
      message: `Verifying branch diff for pr_ready: branch=${worktree.branch}`,
    }).catch(() => {});
    try {
      const gitOps = this.createGitOps(worktree.path);
      const diffContent = await gitOps.diff('origin/main', worktree.branch);
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Branch diff result: hasChanges=${diffContent.trim().length > 0}, diffLength=${diffContent.length}`,
      }).catch(() => {});
      if (diffContent.trim().length === 0) {
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'warning',
          message: 'Agent reported pr_ready but no changes detected on branch — using no_changes outcome',
          data: { branch: worktree.branch },
        });
        return 'no_changes';
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
    return 'pr_ready';
  }

  private async detectConflicts(taskId: string, worktree: { branch: string; path: string }): Promise<'pr_ready' | 'conflicts_detected'> {
    try {
      const gitOps = this.createGitOps(worktree.path);
      await gitOps.fetch('origin');
      await gitOps.rebase('origin/main');
      await this.taskEventLog.log({
        taskId,
        category: 'git',
        severity: 'info',
        message: 'Pre-transition rebase onto origin/main succeeded',
      });
    } catch {
      try {
        const gitOps = this.createGitOps(worktree.path);
        await gitOps.rebaseAbort();
      } catch { /* may not be in rebase state */ }
      await this.taskEventLog.log({
        taskId,
        category: 'git',
        severity: 'warning',
        message: 'Merge conflicts with origin/main detected — switching to conflicts_detected outcome',
        data: { branch: worktree.branch },
      });
      return 'conflicts_detected';
    }
    return 'pr_ready';
  }

  async tryOutcomeTransition(taskId: string, outcome: string, data?: Record<string, unknown>): Promise<void> {
    this.taskEventLog.log({
      taskId,
      category: 'agent_debug',
      severity: 'debug',
      message: `tryOutcomeTransition: taskId=${taskId}, outcome=${outcome}`,
    }).catch(() => {});

    const task = await this.taskStore.getTask(taskId);
    if (!task) return;

    const transitions = await this.pipelineEngine.getValidTransitions(task, 'agent');
    const candidates = transitions.filter((t) => t.agentOutcome === outcome);
    if (candidates.length > 1) {
      const resumeTo = data?.resumeToStatus as string | undefined;
      if (!resumeTo) {
        this.taskEventLog.log({
          taskId,
          category: 'system',
          severity: 'warning',
          message: `Multiple transitions match outcome "${outcome}" from "${task.status}" but no resumeToStatus provided — using first match (${candidates[0].to})`,
          data: { outcome, candidates: candidates.map(c => c.to) },
        }).catch(() => {});
      }
    }
    const resumeTo = data?.resumeToStatus as string | undefined;
    const match = (resumeTo
      ? candidates.find((t) => t.to === resumeTo)
      : undefined)
      ?? candidates[0];
    if (match) {
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Found matching transition: ${task.status} → ${match.to}`,
      }).catch(() => {});
      const ctx: TransitionContext = { trigger: 'agent', data: { outcome, ...data } };
      const result = await this.pipelineEngine.executeTransition(task, match.to, ctx);
      if (result.success) {
        this.taskEventLog.log({
          taskId,
          category: 'agent_debug',
          severity: 'debug',
          message: `Outcome transition succeeded: ${task.status} → ${match.to}`,
        }).catch(() => {});
      } else {
        await this.taskEventLog.log({
          taskId,
          category: 'system',
          severity: 'warning',
          message: `Outcome transition "${outcome}" to "${match.to}" failed: ${result.error ?? result.guardFailures?.map((g) => g.reason).join(', ')}`,
          data: { outcome, toStatus: match.to, error: result.error, guardFailures: result.guardFailures },
        });
        throw new Error(`Outcome transition "${outcome}" to "${match.to}" failed: ${result.error ?? result.guardFailures?.map((g) => g.reason).join(', ')}`);
      }
    } else {
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `No matching transition found for outcome=${outcome} from status=${task.status}`,
      }).catch(() => {});
    }
  }
}
