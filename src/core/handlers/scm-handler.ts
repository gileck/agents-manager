import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { IGitOps } from '../interfaces/git-ops';
import type { IScmPlatform } from '../interfaces/scm-platform';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { Task, Transition, TransitionContext, HookResult } from '../../shared/types';
import { getActivePhase, getActivePhaseIndex, isMultiPhase } from '../../shared/phase-utils';

export interface ScmHandlerDeps {
  projectStore: IProjectStore;
  taskStore: ITaskStore;
  taskArtifactStore: ITaskArtifactStore;
  taskEventLog: ITaskEventLog;
  taskContextStore: ITaskContextStore;
  createWorktreeManager: (projectPath: string) => IWorktreeManager;
  createGitOps: (cwd: string) => IGitOps;
  createScmPlatform: (repoPath: string) => IScmPlatform;
  onMainDiverged?: (projectId: string) => void;
}

async function captureAndReturnMergeFailure(
  task: Task, error: string, prUrl: string, scmPlatform: IScmPlatform,
  taskContextStore: ITaskContextStore, ghLog: (message: string, severity?: 'info' | 'warning' | 'error') => Promise<unknown>,
): Promise<HookResult> {
  // Try to get PR checks for detailed context
  let checksInfo: Record<string, unknown> = {};
  try {
    const checks = await scmPlatform.getPRChecks(prUrl);
    checksInfo = {
      mergeable: checks.mergeable,
      mergeStateStatus: checks.mergeStateStatus,
      prState: checks.prState,
      failingChecks: checks.checks
        .filter(c => c.conclusion != null && c.conclusion !== 'SUCCESS')
        .map(c => ({ name: c.name, status: c.conclusion ?? c.state })),
    };
  } catch (err) {
    await ghLog(`Failed to fetch PR checks (non-fatal): ${err}`, 'warning');
  }

  try {
    await taskContextStore.addEntry({
      taskId: task.id,
      source: 'system',
      entryType: 'merge_failure',
      summary: `PR merge failed: ${error}`,
      data: { errorMessage: error, prUrl, ...checksInfo, timestamp: Date.now() },
    });
  } catch (err) {
    await ghLog(`Failed to store merge failure context (non-fatal): ${err}`, 'warning');
  }

  return { success: false, error, followUpTransition: { to: 'implementing', trigger: 'system' as const } };
}

export function registerScmHandler(engine: IPipelineEngine, deps: ScmHandlerDeps): void {
  engine.registerHook('merge_pr', async (task: Task, _transition: Transition, context: TransitionContext, _params?: Record<string, unknown>): Promise<HookResult> => {
    const correlationId = context.correlationId;
    const ghLog = (message: string, severity: 'info' | 'warning' | 'error' = 'info', data?: Record<string, unknown>) =>
      deps.taskEventLog.log({ taskId: task.id, category: 'github', severity, message, data: { hookName: 'merge_pr', ...data }, correlationId });

    const artifacts = await deps.taskArtifactStore.getArtifactsForTask(task.id, 'pr');
    if (artifacts.length === 0) {
      const msg = 'merge_pr hook: no PR artifact found';
      await ghLog(msg, 'error');
      throw new Error(msg);
    }

    const prUrl = artifacts[artifacts.length - 1].data.url as string;
    const project = await deps.projectStore.getProject(task.projectId);
    if (!project?.path) {
      await ghLog(`merge_pr hook: project ${task.projectId} has no path`, 'error');
      return { success: false, error: `Project ${task.projectId} has no path` };
    }

    const scmPlatform = deps.createScmPlatform(project.path);

    // Pre-merge mergeability check BEFORE worktree deletion so the worktree
    // is preserved for recovery if the PR can't be merged.
    try {
      const mergeable = await scmPlatform.isPRMergeable(prUrl, (message) => {
        void ghLog(message, 'info', { url: prUrl });
      });
      if (!mergeable) {
        const msg = 'PR is not mergeable (likely has conflicts with base branch)';
        await ghLog(msg, 'error', { url: prUrl });
        return captureAndReturnMergeFailure(task, msg, prUrl, scmPlatform, deps.taskContextStore, ghLog);
      }
    } catch (err) {
      // If the mergeability check itself fails, log and continue
      // to let GitHub's own merge logic be the final arbiter
      await ghLog(`Mergeability check failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }

    // Remove worktree before merge so --delete-branch can clean up the local branch.
    // Done after mergeability check so the worktree is preserved if merge will fail.
    const worktreeManager = deps.createWorktreeManager(project.path);
    try {
      await worktreeManager.unlock(task.id);
      await worktreeManager.delete(task.id);
      await ghLog('Worktree removed before merge', 'info', { taskId: task.id });
    } catch (err) {
      await ghLog(`Worktree cleanup before merge failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }

    await ghLog(`Merging PR: ${prUrl}`);
    try {
      await scmPlatform.mergePR(prUrl);
      await ghLog('PR merged successfully', 'info', { url: prUrl });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await ghLog(`Failed to merge PR: ${errMsg}`, 'error', { error: errMsg });
      if (/conflict|not mergeable/i.test(errMsg)) {
        return captureAndReturnMergeFailure(task, errMsg, prUrl, scmPlatform, deps.taskContextStore, ghLog);
      }
      throw err; // Let pipeline engine log the hook failure
    }

    // Optionally update local main to stay current with merged task branches.
    // Skip for phase merges (which target the task integration branch, not main).
    const taskBranchForMerge = (task.metadata?.taskBranch as string) || undefined;
    const isPhaseMerge = isMultiPhase(task) && taskBranchForMerge && (task.phases ?? []).some(p => p.status === 'pending' || p.status === 'in_progress');
    if (project.config?.pullMainAfterMerge && !isPhaseMerge) {
      try {
        const gitOps = deps.createGitOps(project.path);
        const currentBranch = await gitOps.getCurrentBranch();
        if (currentBranch === 'main') {
          try {
            await gitOps.pull('main', { ffOnly: true });
            await ghLog('Pulled latest main into primary worktree');
          } catch {
            await ghLog('Local main has unpushed commits — notifying user', 'warning');
            deps.onMainDiverged?.(project.id);
          }
        } else {
          await gitOps.fetch('origin', 'main:main');
          await ghLog('Fetched origin/main to local main');
        }
      } catch (err) {
        await ghLog(`Failed to update main after merge (non-fatal): ${err instanceof Error ? err.message : String(err)}`, 'warning');
      }
    }

    return { success: true };
  });

  engine.registerHook('push_and_create_pr', async (task: Task, transition: Transition, context: TransitionContext, _params?: Record<string, unknown>): Promise<HookResult> => {
    const correlationId = context.correlationId;
    const data = context.data as { branch?: string } | undefined;
    const branch = data?.branch;
    if (!branch) {
      await deps.taskEventLog.log({
        taskId: task.id,
        category: 'git',
        severity: 'error',
        message: 'push_and_create_pr hook: no branch in transition context',
        data: { hookName: 'push_and_create_pr' },
        correlationId,
      });
      return { success: false, error: 'No branch in transition context' };
    }

    const project = await deps.projectStore.getProject(task.projectId);
    if (!project?.path) {
      await deps.taskEventLog.log({
        taskId: task.id,
        category: 'git',
        severity: 'error',
        message: `push_and_create_pr hook: project ${task.projectId} has no path`,
        data: { hookName: 'push_and_create_pr' },
        correlationId,
      });
      return { success: false, error: `Project ${task.projectId} has no path` };
    }

    const scmPlatform = deps.createScmPlatform(project.path);

    const gitLog = (message: string, severity: 'info' | 'warning' | 'error' = 'info', logData?: Record<string, unknown>) =>
      deps.taskEventLog.log({ taskId: task.id, category: 'git', severity, message, data: { hookName: 'push_and_create_pr', ...logData }, correlationId });
    const ghLog = (message: string, severity: 'info' | 'warning' | 'error' = 'info', logData?: Record<string, unknown>) =>
      deps.taskEventLog.log({ taskId: task.id, category: 'github', severity, message, data: { hookName: 'push_and_create_pr', ...logData }, correlationId });

    // Resolve the worktree path for this task so git operations run in the
    // checked-out branch (not the main repo checkout).
    const worktreeManager = deps.createWorktreeManager(project.path);
    const worktree = await worktreeManager.get(task.id);
    const gitCwd = worktree?.path ?? project.path;
    const gitOps = deps.createGitOps(gitCwd);

    // For multi-phase tasks, rebase/diff/PR against the task integration branch
    // instead of main. Phase PRs merge into the task branch; only the final PR
    // (created by advance_phase) targets main.
    const freshTaskForBranch = await deps.taskStore.getTask(task.id);
    const taskBranch = (freshTaskForBranch?.metadata?.taskBranch as string) || undefined;
    const isMultiPhaseTask = freshTaskForBranch ? isMultiPhase(freshTaskForBranch) : false;
    const rebaseRef = isMultiPhaseTask && taskBranch ? `origin/${taskBranch}` : 'origin/main';

    // Rebase onto the base ref before push so the PR diff only contains agent
    // changes and doesn't include unpushed local commits from other tasks.
    try {
      await gitOps.fetch('origin');
    } catch (fetchErr) {
      const fetchMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      await gitLog(`Fetch failed before rebase: ${fetchMsg}`, 'error');
      return { success: false, error: `Fetch failed: ${fetchMsg}` };
    }

    try {
      await gitOps.rebase(rebaseRef);
      await gitLog(`Rebased onto ${rebaseRef} before push`);
    } catch (err) {
      // Abort the broken rebase so the worktree is usable
      try { await gitOps.rebaseAbort(); } catch { /* may not be in rebase state */ }
      const errorMsg = err instanceof Error ? err.message : String(err);
      await gitLog(`Rebase onto ${rebaseRef} failed (merge conflicts): ${errorMsg}`, 'error');

      // Store merge failure context for the recovery agent
      try {
        await deps.taskContextStore.addEntry({
          taskId: task.id,
          source: 'system',
          entryType: 'merge_failure',
          summary: `Rebase failed during push_and_create_pr: ${errorMsg}`,
          data: { errorMessage: errorMsg, rebaseRef, branch, timestamp: Date.now() },
        });
      } catch (ctxErr) {
        await gitLog(`Failed to store merge failure context (non-fatal): ${ctxErr}`, 'warning');
      }

      return { success: false, error: 'Merge conflicts detected — rebase failed', followUpTransition: { to: 'implementing', trigger: 'system' as const } };
    }

    // Collect diff against the base ref (what GitHub will compare against)
    await gitLog(`Collecting diff: ${rebaseRef}..${branch}`);
    let diffContent = '';
    try {
      diffContent = await gitOps.diff(rebaseRef, branch);
      // Remove stale diff artifacts before creating the fresh one so the UI
      // always reflects the current state of the branch.
      await deps.taskArtifactStore.deleteArtifactsByType(task.id, 'diff');
      await deps.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'diff',
        data: { diff: diffContent },
      });
      await gitLog(`Diff collected (${diffContent.length} chars)`, diffContent.length === 0 ? 'warning' : 'info');
    } catch (err) {
      await gitLog(`Failed to collect diff: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }

    // Skip push + PR if no changes on branch
    if (diffContent.trim().length === 0) {
      await gitLog('No changes detected on branch — skipping push and PR creation', 'warning', { branch });
      return { success: true };
    }

    // Push task branch (force-push since rebase rewrites history)
    await gitLog('Pushing branch to remote: ' + branch);
    try {
      await gitOps.push(branch, true);
      await gitLog('Branch pushed successfully');
    } catch (err) {
      await gitLog(`Failed to push branch: ${err instanceof Error ? err.message : String(err)}`, 'error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { success: false, error: 'Failed to push branch' };
    }

    // If a PR already exists for this task on the same branch, the force-push
    // above updated it. Skip creation and return success. For multi-phase tasks,
    // each phase uses a different branch and needs its own PR.
    const existingPrArtifacts = await deps.taskArtifactStore.getArtifactsForTask(task.id, 'pr');
    if (existingPrArtifacts.length > 0) {
      const latestPr = existingPrArtifacts[existingPrArtifacts.length - 1];
      const prBranch = latestPr.data.branch as string | undefined;
      if (prBranch === branch) {
        await ghLog('PR already exists for this branch — force-push updated it', 'info', { url: latestPr.data.url, branch });
        return { success: true };
      }
      await ghLog('Existing PR is for a different branch — creating new PR for this phase', 'info', { existingBranch: prBranch, currentBranch: branch });
    }

    // Create PR
    await ghLog('Creating pull request');
    try {
      const freshTask = await deps.taskStore.getTask(task.id);
      // Multi-phase PRs target the task integration branch; single-phase PRs target main
      const defaultBranch = (project.config?.defaultBranch as string) || 'main';
      const baseBranch = isMultiPhaseTask && taskBranch ? taskBranch : defaultBranch;

      // Phase-aware PR title and body
      let prTitle = freshTask?.title ?? 'PR';
      let prBody = `Automated PR for task ${task.id}`;
      if (freshTask && isMultiPhase(freshTask)) {
        const activePhase = getActivePhase(freshTask.phases);
        const phaseIdx = getActivePhaseIndex(freshTask.phases);
        const totalPhases = freshTask.phases?.length ?? 0;
        if (activePhase && phaseIdx >= 0) {
          prTitle = `[Phase ${phaseIdx + 1}/${totalPhases}] ${freshTask.title}`;
          const subtaskList = activePhase.subtasks.map(s => `- [ ] ${s.name}`).join('\n');
          prBody = `## ${activePhase.name}\n\nPhase ${phaseIdx + 1} of ${totalPhases} for task ${task.id}\n\n### Subtasks\n${subtaskList}`;
        }
      }

      const prInfo = await scmPlatform.createPR({
        title: prTitle,
        body: prBody,
        head: branch,
        base: baseBranch,
      });

      await deps.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: prInfo.url, number: prInfo.number, branch },
      });

      await deps.taskStore.updateTask(task.id, {
        prLink: prInfo.url,
        branchName: branch,
      });

      await ghLog('PR created successfully', 'info', { url: prInfo.url, number: prInfo.number });
    } catch (err) {
      await ghLog(`Failed to create PR: ${err instanceof Error ? err.message : String(err)}`, 'error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { success: false, error: 'Failed to create PR' };
    }

    return { success: true };
  });
}
