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
    summary?: string;
  }): Promise<void> {
    const { taskId, result, run, worktree, worktreeManager, phase, context, summary } = params;
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

      // Early conflict detection (skip for conflicts_detected revision)
      if (effectiveOutcome === 'pr_ready' && context.revisionReason !== 'conflicts_detected') {
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
          ...(summary ? { summary } : {}),
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
    const gitOps = this.createGitOps(worktree.path);
    await gitOps.fetch('origin');

    // Fast-path: if branch is already rebased onto origin/main, skip the rebase attempt
    try {
      const [mergeBase, originMain] = await Promise.all([
        gitOps.mergeBase('HEAD', 'origin/main'),
        gitOps.revParse('origin/main'),
      ]);
      if (mergeBase === originMain) {
        await this.taskEventLog.log({
          taskId,
          category: 'git',
          severity: 'info',
          message: 'Branch already rebased onto origin/main — skipping rebase',
        });
        return 'pr_ready';
      }
    } catch {
      // merge-base check failed — fall through to rebase
    }

    try {
      await gitOps.rebase('origin/main');
      await this.taskEventLog.log({
        taskId,
        category: 'git',
        severity: 'info',
        message: 'Pre-transition rebase onto origin/main succeeded',
      });
    } catch {
      try {
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

    // Order candidates: if resumeToStatus is set, put that candidate first
    const resumeTo = data?.resumeToStatus as string | undefined;
    const ordered = resumeTo
      ? [...candidates.filter(t => t.to === resumeTo), ...candidates.filter(t => t.to !== resumeTo)]
      : candidates;

    // Try each candidate in order — fall through on guard failures to support
    // guarded transitions (e.g. multi-phase auto-merge) with ungarded fallbacks.
    for (const match of ordered) {
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
        return;
      }

      // Guard failure — try next candidate
      if (result.guardFailures && result.guardFailures.length > 0) {
        this.taskEventLog.log({
          taskId,
          category: 'agent_debug',
          severity: 'debug',
          message: `Outcome transition "${outcome}" to "${match.to}" blocked by guards (${result.guardFailures.map(g => g.reason).join(', ')}) — trying next candidate`,
          data: { outcome, toStatus: match.to, guardFailures: result.guardFailures },
        }).catch(() => {});
        continue;
      }

      // Non-guard failure — this is an error, throw
      await this.taskEventLog.log({
        taskId,
        category: 'system',
        severity: 'warning',
        message: `Outcome transition "${outcome}" to "${match.to}" failed: ${result.error ?? 'unknown'}`,
        data: { outcome, toStatus: match.to, error: result.error },
      });
      throw new Error(`Outcome transition "${outcome}" to "${match.to}" failed: ${result.error ?? 'unknown'}`);
    }

    // No candidate succeeded
    if (ordered.length > 0) {
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'warning',
        message: `All ${ordered.length} candidate transitions for outcome="${outcome}" from status="${task.status}" were blocked by guards`,
        data: { outcome, taskStatus: task.status, candidates: ordered.map(t => t.to) },
      });
    } else {
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'warning',
        message: `No matching transition found for outcome="${outcome}" from status="${task.status}" — agent result discarded`,
        data: {
          outcome,
          taskStatus: task.status,
          availableTransitions: transitions.map(t => ({ to: t.to, agentOutcome: t.agentOutcome })),
          ...(data?.agentRunId ? { agentRunId: data.agentRunId } : {}),
        },
      });
    }
  }
}
