import type { AgentRunResult, AgentContext, TransitionContext, PostProcessingLogCategory } from '../../shared/types';
import type { IGitOps } from '../interfaces/git-ops';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskPhaseStore } from '../interfaces/task-phase-store';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import { isMultiPhase } from '../../shared/phase-utils';
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
    private agentRunStore?: IAgentRunStore,
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

      // Resolve the correct base ref for diff/conflict checks.
      // Multi-phase tasks use the integration branch; single-phase use origin/main.
      const freshTask = await this.taskStore.getTask(taskId);
      const taskBranch = (freshTask?.metadata?.taskBranch as string) || undefined;
      const baseRef = freshTask && isMultiPhase(freshTask) && taskBranch
        ? `origin/${taskBranch}`
        : 'origin/main';

      if (effectiveOutcome === 'pr_ready') {
        effectiveOutcome = await this.verifyBranchDiff(taskId, worktree, baseRef, onPostLog);
      }

      // If uncommitted_changes was detected but this is already the retry run,
      // discard the changes and fall through to no_changes (→ open).
      if (effectiveOutcome === 'uncommitted_changes' && context.revisionReason === 'uncommitted_changes') {
        onPostLog?.('git', 'Uncommitted changes retry failed again — discarding and using no_changes', { branch: worktree.branch });
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'warning',
          message: 'Uncommitted changes retry exhausted — discarding uncommitted changes from worktree',
          data: { branch: worktree.branch },
        });
        try {
          const gitOps = this.createGitOps(worktree.path);
          await gitOps.clean();
        } catch (cleanErr) {
          const cleanMsg = cleanErr instanceof Error ? cleanErr.message : String(cleanErr);
          onPostLog?.('git', `Failed to clean worktree after retry exhaustion: ${cleanMsg}`, { branch: worktree.branch });
          this.taskEventLog.log({
            taskId,
            category: 'git',
            severity: 'warning',
            message: `Best-effort worktree clean failed after uncommitted_changes retry exhausted: ${cleanMsg}`,
            data: { branch: worktree.branch },
          }).catch(() => {});
        }
        effectiveOutcome = 'no_changes';
      }

      // Early conflict detection — always run so conflicts are caught before
      // the push_and_create_pr hook attempts a rebase with no recovery path.
      if (effectiveOutcome === 'pr_ready') {
        effectiveOutcome = await this.detectConflicts(taskId, worktree, baseRef, onPostLog);
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

    // For failed runs, attempt failure transition (pipeline may retry via hooks).
    // Skip this for user-stopped agents (killReason === 'stopped') — they should
    // not trigger autoRetry; the run is already marked 'cancelled' by stop().
    if (result.exitCode !== 0 && result.killReason !== 'stopped') {
      await this.tryOutcomeTransition(taskId, 'failed', { agentRunId: run.id }, onPostLog);
    } else if (result.killReason === 'stopped') {
      onPostLog?.('system', 'Agent was stopped by user — skipping failure transition');
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'info',
        message: 'Agent stopped by user — no auto-retry will be triggered',
        data: { agentRunId: run.id, killReason: result.killReason },
      });
    }
  }

  private async verifyBranchDiff(taskId: string, worktree: { branch: string; path: string }, baseRef: string, onPostLog?: OnPostLog): Promise<'pr_ready' | 'no_changes' | 'already_on_main' | 'uncommitted_changes'> {
    onPostLog?.('git', `Verifying branch diff: branch=${worktree.branch}, baseRef=${baseRef}`, { branch: worktree.branch, baseRef });
    const diffStart = performance.now();
    this.taskEventLog.log({
      taskId,
      category: 'agent_debug',
      severity: 'debug',
      message: `Verifying branch diff for pr_ready: branch=${worktree.branch}, baseRef=${baseRef}`,
    }).catch(() => {});
    try {
      const gitOps = this.createGitOps(worktree.path);
      const diffContent = await gitOps.diff(baseRef, worktree.branch);
      const diffDuration = Math.round(performance.now() - diffStart);
      const hasChanges = diffContent.trim().length > 0;
      onPostLog?.('git', `git diff ${baseRef}..${worktree.branch}: hasChanges=${hasChanges}, diffLength=${diffContent.length}`, { hasChanges, diffLength: diffContent.length }, diffDuration);
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Branch diff result: hasChanges=${hasChanges}, diffLength=${diffContent.length}`,
      }).catch(() => {});
      if (!hasChanges) {
        // Check whether the branch has unique commits beyond the base ref.
        // If HEAD equals the base ref, the work is already merged —
        // return already_on_main so the task transitions to done
        // instead of looping back to open via no_changes.
        try {
          const revParseStart = performance.now();
          const [headSha, baseSha] = await Promise.all([
            gitOps.revParse('HEAD'),
            gitOps.revParse(baseRef),
          ]);
          const revParseDuration = Math.round(performance.now() - revParseStart);
          onPostLog?.('git', `rev-parse HEAD=${headSha.slice(0, 8)}, ${baseRef}=${baseSha.slice(0, 8)}`, { headSha, baseSha, baseRef }, revParseDuration);
          if (headSha === baseSha) {
            // Before assuming "already merged", check if there are prior completed
            // implementor runs for this task. If this is the first run, the agent
            // simply failed to produce commits — return no_changes instead.
            let hasPriorCompletedRuns = false;
            if (this.agentRunStore) {
              try {
                const runs = await this.agentRunStore.getRunsForTask(taskId);
                // Count completed implementor runs (excluding the current one that just finished).
                // A completed run with outcome pr_ready or similar indicates a prior successful attempt.
                const completedImplRuns = runs.filter(
                  r => r.agentType === 'implementor' && r.status === 'completed',
                );
                hasPriorCompletedRuns = completedImplRuns.length > 1;
              } catch (runQueryErr) {
                onPostLog?.('git', `Failed to query prior runs: ${runQueryErr instanceof Error ? runQueryErr.message : String(runQueryErr)}`);
                // Fall through — if we can't determine history, use the safer no_changes
              }
            }

            if (hasPriorCompletedRuns) {
              onPostLog?.('git', `Branch HEAD equals ${baseRef} — changes already merged (prior completed runs exist)`);
              await this.taskEventLog.log({
                taskId,
                category: 'agent',
                severity: 'warning',
                message: `No diff detected and branch HEAD equals ${baseRef} — changes likely already merged`,
                data: { branch: worktree.branch, headSha, baseSha, baseRef },
              });
              return 'already_on_main';
            }

            // First implementor run with zero commits — agent failed to produce changes
            onPostLog?.('git', `Branch HEAD equals ${baseRef} but no prior completed implementor runs — treating as no_changes`);
            await this.taskEventLog.log({
              taskId,
              category: 'agent',
              severity: 'warning',
              message: `No diff detected and branch HEAD equals ${baseRef} — first implementor run produced zero commits, treating as no_changes`,
              data: { branch: worktree.branch, headSha, baseSha, baseRef, hasPriorCompletedRuns },
            });
            return 'no_changes';
          }
        } catch (revParseErr) {
          onPostLog?.('git', `rev-parse failed: ${revParseErr instanceof Error ? revParseErr.message : String(revParseErr)}`);
          await this.taskEventLog.log({
            taskId,
            category: 'agent',
            severity: 'warning',
            message: `Empty diff detected but failed to resolve HEAD/${baseRef} SHAs: ${revParseErr instanceof Error ? revParseErr.message : String(revParseErr)}`,
            data: { branch: worktree.branch, baseRef },
          });
          // Fall through to no_changes — diff is empty, just couldn't determine why
        }
        // Safety net: check for uncommitted changes in the worktree.
        // If the agent edited files but failed to commit (e.g. SDK permission errors),
        // the branch diff will be empty even though work was done.
        // Return 'uncommitted_changes' to trigger a self-transition that resumes
        // the agent so it can commit its work.
        try {
          const statusOutput = await gitOps.status();
          if (statusOutput.trim().length > 0) {
            onPostLog?.('git', 'No committed changes on branch but worktree has uncommitted modifications — using uncommitted_changes outcome', { branch: worktree.branch, statusLength: statusOutput.length });
            await this.taskEventLog.log({
              taskId,
              category: 'agent',
              severity: 'warning',
              message: 'Agent reported pr_ready with uncommitted changes — resuming agent to commit',
              data: { branch: worktree.branch, status: statusOutput.slice(0, 500) },
            });
            return 'uncommitted_changes';
          }
        } catch (statusErr) {
          const statusMsg = statusErr instanceof Error ? statusErr.message : String(statusErr);
          onPostLog?.('git', `git status failed in uncommitted changes check: ${statusMsg}`, { branch: worktree.branch });
          this.taskEventLog.log({
            taskId,
            category: 'git',
            severity: 'warning',
            message: `Failed to check for uncommitted changes (git status): ${statusMsg} — falling through to no_changes`,
            data: { branch: worktree.branch },
          }).catch(() => {});
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

  private async detectConflicts(taskId: string, worktree: { branch: string; path: string }, baseRef: string, onPostLog?: OnPostLog): Promise<'pr_ready' | 'conflicts_detected'> {
    const gitOps = this.createGitOps(worktree.path);
    onPostLog?.('git', `Fetching origin for conflict detection (baseRef=${baseRef})`);
    try {
      const fetchStart = performance.now();
      await gitOps.fetch('origin');
      const fetchDuration = Math.round(performance.now() - fetchStart);
      onPostLog?.('git', 'git fetch origin complete', undefined, fetchDuration);
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      onPostLog?.('git', `git fetch origin failed during conflict detection: ${msg} — skipping conflict check`, { baseRef, error: msg });
      await this.taskEventLog.log({
        taskId,
        category: 'git',
        severity: 'warning',
        message: `Conflict detection skipped: fetch failed: ${msg}`,
        data: { baseRef, error: msg },
      });
      return 'pr_ready'; // Let push_and_create_pr hook handle conflicts
    }

    // Fast-path: if branch is already rebased onto the base ref, skip the rebase attempt
    try {
      const mergeBaseStart = performance.now();
      const [mergeBase, baseHead] = await Promise.all([
        gitOps.mergeBase('HEAD', baseRef),
        gitOps.revParse(baseRef),
      ]);
      const mergeBaseDuration = Math.round(performance.now() - mergeBaseStart);
      onPostLog?.('git', `merge-base HEAD ${baseRef} = ${mergeBase.slice(0, 8)}, ${baseRef} = ${baseHead.slice(0, 8)}`, { mergeBase, baseHead, baseRef }, mergeBaseDuration);
      if (mergeBase === baseHead) {
        onPostLog?.('git', `Branch already rebased onto ${baseRef} — skipping rebase`);
        await this.taskEventLog.log({
          taskId,
          category: 'git',
          severity: 'info',
          message: `Branch already rebased onto ${baseRef} — skipping rebase`,
        });
        return 'pr_ready';
      }
    } catch (mbErr) {
      const msg = mbErr instanceof Error ? mbErr.message : String(mbErr);
      onPostLog?.('git', `merge-base check failed: ${msg} — falling through to rebase`, { error: msg });
      // merge-base check failed — fall through to rebase
    }

    try {
      onPostLog?.('git', `Rebasing onto ${baseRef}`);
      const rebaseStart = performance.now();
      await gitOps.rebase(baseRef);
      const rebaseDuration = Math.round(performance.now() - rebaseStart);
      onPostLog?.('git', `Rebase onto ${baseRef} succeeded`, undefined, rebaseDuration);
      await this.taskEventLog.log({
        taskId,
        category: 'git',
        severity: 'info',
        message: `Pre-transition rebase onto ${baseRef} succeeded`,
      });
    } catch (rebaseErr) {
      try {
        await gitOps.rebaseAbort();
      } catch { /* may not be in rebase state */ }
      const errMsg = rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr);
      onPostLog?.('git', `Rebase onto ${baseRef} failed: ${errMsg} — switching to conflicts_detected outcome`, { branch: worktree.branch, baseRef, error: errMsg });
      await this.taskEventLog.log({
        taskId,
        category: 'git',
        severity: 'warning',
        message: `Rebase onto ${baseRef} failed: ${errMsg} — switching to conflicts_detected outcome`,
        data: { branch: worktree.branch, baseRef, error: errMsg },
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
