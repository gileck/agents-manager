import type { AgentRunResult, AgentContext, TransitionContext, PostProcessingLogCategory } from '../../shared/types';
import type { IGitOps } from '../interfaces/git-ops';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskPhaseStore } from '../interfaces/task-phase-store';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import { now } from '../stores/utils';

type OnPostLog = (category: PostProcessingLogCategory, message: string, details?: Record<string, unknown>, durationMs?: number) => void;

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
    onPostLog?: OnPostLog;
  }): Promise<void> {
    const { taskId, result, run, worktree, worktreeManager, phase, context, summary, onPostLog } = params;
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
        effectiveOutcome = await this.verifyBranchDiff(taskId, worktree, onPostLog);
      }

      // Early conflict detection (skip for merge_failed revision)
      if (effectiveOutcome === 'pr_ready' && context.revisionReason !== 'merge_failed') {
        effectiveOutcome = await this.detectConflicts(taskId, worktree, onPostLog);
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
        }, onPostLog);
      }
    } else {
      await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
    }

    // Cleanup — unlock before retry transition so the new agent can acquire the lock.
    try {
      onPostLog?.('system', 'Unlocking worktree', { taskId });
      const unlockStart = performance.now();
      await worktreeManager.unlock(taskId);
      const unlockDuration = Math.round(performance.now() - unlockStart);
      onPostLog?.('system', 'Worktree unlocked', { taskId }, unlockDuration);
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'debug',
        message: 'Worktree unlocked',
        data: { taskId },
      });
    } catch {
      onPostLog?.('system', 'Worktree unlock skipped (already deleted or not locked)');
      // Worktree may have been deleted by a transition hook — safe to ignore
    }

    // For failed runs, attempt failure transition (pipeline may retry via hooks)
    if (result.exitCode !== 0) {
      await this.tryOutcomeTransition(taskId, 'failed', { agentRunId: run.id }, onPostLog);
    }
  }

  private async verifyBranchDiff(taskId: string, worktree: { branch: string; path: string }, onPostLog?: OnPostLog): Promise<'pr_ready' | 'no_changes' | 'already_on_main'> {
    onPostLog?.('git', `Verifying branch diff: branch=${worktree.branch}`, { branch: worktree.branch });
    const diffStart = performance.now();
    this.taskEventLog.log({
      taskId,
      category: 'agent_debug',
      severity: 'debug',
      message: `Verifying branch diff for pr_ready: branch=${worktree.branch}`,
    }).catch(() => {});
    try {
      const gitOps = this.createGitOps(worktree.path);
      const diffContent = await gitOps.diff('origin/main', worktree.branch);
      const diffDuration = Math.round(performance.now() - diffStart);
      const hasChanges = diffContent.trim().length > 0;
      onPostLog?.('git', `git diff origin/main..${worktree.branch}: hasChanges=${hasChanges}, diffLength=${diffContent.length}`, { hasChanges, diffLength: diffContent.length }, diffDuration);
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Branch diff result: hasChanges=${hasChanges}, diffLength=${diffContent.length}`,
      }).catch(() => {});
      if (!hasChanges) {
        // Check whether the branch has unique commits beyond origin/main.
        // If HEAD equals origin/main, the work is already on main —
        // return already_on_main so the task transitions to done
        // instead of looping back to open via no_changes.
        try {
          const revParseStart = performance.now();
          const [headSha, mainSha] = await Promise.all([
            gitOps.revParse('HEAD'),
            gitOps.revParse('origin/main'),
          ]);
          const revParseDuration = Math.round(performance.now() - revParseStart);
          onPostLog?.('git', `rev-parse HEAD=${headSha.slice(0, 8)}, origin/main=${mainSha.slice(0, 8)}`, { headSha, mainSha }, revParseDuration);
          if (headSha === mainSha) {
            onPostLog?.('git', 'Branch HEAD equals origin/main — changes already on main');
            await this.taskEventLog.log({
              taskId,
              category: 'agent',
              severity: 'warning',
              message: 'No diff detected and branch HEAD equals origin/main — changes likely already on main',
              data: { branch: worktree.branch, headSha, mainSha },
            });
            return 'already_on_main';
          }
        } catch (revParseErr) {
          onPostLog?.('git', `rev-parse failed: ${revParseErr instanceof Error ? revParseErr.message : String(revParseErr)}`);
          await this.taskEventLog.log({
            taskId,
            category: 'agent',
            severity: 'warning',
            message: `Empty diff detected but failed to resolve HEAD/origin/main SHAs: ${revParseErr instanceof Error ? revParseErr.message : String(revParseErr)}`,
            data: { branch: worktree.branch },
          });
          // Fall through to no_changes — diff is empty, just couldn't determine why
        }
        onPostLog?.('git', 'No changes detected on branch — using no_changes outcome', { branch: worktree.branch });
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
      const diffDuration = Math.round(performance.now() - diffStart);
      onPostLog?.('git', `Branch diff verification failed: ${err instanceof Error ? err.message : String(err)}`, { branch: worktree.branch, error: err instanceof Error ? err.message : String(err) }, diffDuration);
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

  private async detectConflicts(taskId: string, worktree: { branch: string; path: string }, onPostLog?: OnPostLog): Promise<'pr_ready' | 'conflicts_detected'> {
    const gitOps = this.createGitOps(worktree.path);
    onPostLog?.('git', 'Fetching origin for conflict detection');
    const fetchStart = performance.now();
    await gitOps.fetch('origin');
    const fetchDuration = Math.round(performance.now() - fetchStart);
    onPostLog?.('git', 'git fetch origin complete', undefined, fetchDuration);

    // Fast-path: if branch is already rebased onto origin/main, skip the rebase attempt
    try {
      const mergeBaseStart = performance.now();
      const [mergeBase, originMain] = await Promise.all([
        gitOps.mergeBase('HEAD', 'origin/main'),
        gitOps.revParse('origin/main'),
      ]);
      const mergeBaseDuration = Math.round(performance.now() - mergeBaseStart);
      onPostLog?.('git', `merge-base HEAD origin/main = ${mergeBase.slice(0, 8)}, origin/main = ${originMain.slice(0, 8)}`, { mergeBase, originMain }, mergeBaseDuration);
      if (mergeBase === originMain) {
        onPostLog?.('git', 'Branch already rebased onto origin/main — skipping rebase');
        await this.taskEventLog.log({
          taskId,
          category: 'git',
          severity: 'info',
          message: 'Branch already rebased onto origin/main — skipping rebase',
        });
        return 'pr_ready';
      }
    } catch {
      onPostLog?.('git', 'merge-base check failed — falling through to rebase');
      // merge-base check failed — fall through to rebase
    }

    try {
      onPostLog?.('git', 'Rebasing onto origin/main');
      const rebaseStart = performance.now();
      await gitOps.rebase('origin/main');
      const rebaseDuration = Math.round(performance.now() - rebaseStart);
      onPostLog?.('git', 'Rebase onto origin/main succeeded', undefined, rebaseDuration);
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
      onPostLog?.('git', 'Merge conflicts detected — switching to conflicts_detected outcome', { branch: worktree.branch });
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

  async tryOutcomeTransition(taskId: string, outcome: string, data?: Record<string, unknown>, onPostLog?: OnPostLog): Promise<void> {
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

    onPostLog?.('pipeline', `Outcome transition: outcome=${outcome}, ${ordered.length} candidate(s) from status="${task.status}"`, {
      outcome, taskStatus: task.status, candidateCount: ordered.length, candidates: ordered.map(t => t.to),
    });

    // Try each candidate in order — fall through on guard failures to support
    // guarded transitions (e.g. multi-phase auto-merge) with ungarded fallbacks.
    for (const match of ordered) {
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Found matching transition: ${task.status} → ${match.to}`,
      }).catch(() => {});
      onPostLog?.('pipeline', `Attempting transition: ${task.status} → ${match.to}`, { from: task.status, to: match.to });
      const transitionStart = performance.now();
      const ctx: TransitionContext = { trigger: 'agent', data: { outcome, ...data } };
      const result = await this.pipelineEngine.executeTransition(task, match.to, ctx, onPostLog);
      const transitionDuration = Math.round(performance.now() - transitionStart);
      if (result.success) {
        onPostLog?.('pipeline', `Transition succeeded: ${task.status} → ${match.to}`, { from: task.status, to: match.to }, transitionDuration);
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
        onPostLog?.('pipeline', `Transition ${task.status} → ${match.to} blocked by guards: ${result.guardFailures.map(g => g.reason).join(', ')}`, {
          from: task.status, to: match.to, guardFailures: result.guardFailures,
        }, transitionDuration);
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
      onPostLog?.('pipeline', `Transition ${task.status} → ${match.to} failed: ${result.error ?? 'unknown'}`, {
        from: task.status, to: match.to, error: result.error,
      }, transitionDuration);
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
      onPostLog?.('pipeline', `All ${ordered.length} candidate transitions for outcome="${outcome}" blocked by guards`, { outcome, taskStatus: task.status });
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'warning',
        message: `All ${ordered.length} candidate transitions for outcome="${outcome}" from status="${task.status}" were blocked by guards`,
        data: { outcome, taskStatus: task.status, candidates: ordered.map(t => t.to) },
      });
    } else {
      onPostLog?.('pipeline', `No matching transition for outcome="${outcome}" from status="${task.status}"`, { outcome, taskStatus: task.status });
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
