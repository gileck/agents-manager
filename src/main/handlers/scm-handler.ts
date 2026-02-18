import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { IGitOps } from '../interfaces/git-ops';
import type { IScmPlatform } from '../interfaces/scm-platform';
import type { Task, Transition, TransitionContext } from '../../shared/types';

export interface ScmHandlerDeps {
  projectStore: IProjectStore;
  taskStore: ITaskStore;
  taskArtifactStore: ITaskArtifactStore;
  taskEventLog: ITaskEventLog;
  createWorktreeManager: (projectPath: string) => IWorktreeManager;
  createGitOps: (cwd: string) => IGitOps;
  createScmPlatform: (repoPath: string) => IScmPlatform;
}

export function registerScmHandler(engine: IPipelineEngine, deps: ScmHandlerDeps): void {
  engine.registerHook('merge_pr', async (task: Task) => {
    const ghLog = (message: string, severity: 'info' | 'warning' | 'error' = 'info', data?: Record<string, unknown>) =>
      deps.taskEventLog.log({ taskId: task.id, category: 'github', severity, message, data });

    const artifacts = await deps.taskArtifactStore.getArtifactsForTask(task.id, 'pr');
    if (artifacts.length === 0) {
      await ghLog('merge_pr hook: no PR artifact found', 'error');
      return;
    }

    const prUrl = artifacts[artifacts.length - 1].data.url as string;
    const project = await deps.projectStore.getProject(task.projectId);
    if (!project?.path) {
      await ghLog(`merge_pr hook: project ${task.projectId} has no path`, 'error');
      return;
    }

    // Remove worktree before merge so --delete-branch can clean up the local branch
    const worktreeManager = deps.createWorktreeManager(project.path);
    try {
      await worktreeManager.unlock(task.id);
      await worktreeManager.delete(task.id);
      await ghLog('Worktree removed before merge', 'info', { taskId: task.id });
    } catch (err) {
      await ghLog(`Worktree cleanup before merge failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }

    const scmPlatform = deps.createScmPlatform(project.path);
    await ghLog(`Merging PR: ${prUrl}`);
    try {
      await scmPlatform.mergePR(prUrl);
      await ghLog('PR merged successfully', 'info', { url: prUrl });
    } catch (err) {
      await ghLog(`Failed to merge PR: ${err instanceof Error ? err.message : String(err)}`, 'error', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err; // Let pipeline engine log the hook failure
    }
  });

  engine.registerHook('push_and_create_pr', async (task: Task, transition: Transition, context: TransitionContext) => {
    const data = context.data as { branch?: string } | undefined;
    const branch = data?.branch;
    if (!branch) {
      await deps.taskEventLog.log({
        taskId: task.id,
        category: 'git',
        severity: 'error',
        message: 'push_and_create_pr hook: no branch in transition context',
      });
      return;
    }

    const project = await deps.projectStore.getProject(task.projectId);
    if (!project?.path) {
      await deps.taskEventLog.log({
        taskId: task.id,
        category: 'git',
        severity: 'error',
        message: `push_and_create_pr hook: project ${task.projectId} has no path`,
      });
      return;
    }

    const gitOps = deps.createGitOps(project.path);
    const scmPlatform = deps.createScmPlatform(project.path);

    const gitLog = (message: string, severity: 'info' | 'warning' | 'error' = 'info', logData?: Record<string, unknown>) =>
      deps.taskEventLog.log({ taskId: task.id, category: 'git', severity, message, data: logData });
    const ghLog = (message: string, severity: 'info' | 'warning' | 'error' = 'info', logData?: Record<string, unknown>) =>
      deps.taskEventLog.log({ taskId: task.id, category: 'github', severity, message, data: logData });

    // Collect diff and verify there are actual changes
    await gitLog('Collecting diff: main..' + branch);
    let diffContent = '';
    try {
      diffContent = await gitOps.diff('main', branch);
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
      return;
    }

    // Push base branch so origin/main is up-to-date
    await gitLog('Pushing base branch (main) to remote');
    try {
      await gitOps.push('main');
      await gitLog('Base branch pushed successfully');
    } catch (err) {
      await gitLog(`Failed to push base branch: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }

    // Push task branch
    await gitLog('Pushing branch to remote: ' + branch);
    try {
      await gitOps.push(branch);
      await gitLog('Branch pushed successfully');
    } catch (err) {
      await gitLog(`Failed to push branch: ${err instanceof Error ? err.message : String(err)}`, 'error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return; // Can't create PR without pushing
    }

    // Create PR
    await ghLog('Creating pull request');
    try {
      const freshTask = await deps.taskStore.getTask(task.id);
      const prInfo = await scmPlatform.createPR({
        title: freshTask?.title ?? 'PR',
        body: `Automated PR for task ${task.id}`,
        head: branch,
        base: 'main',
      });

      await deps.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: prInfo.url, number: prInfo.number },
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
    }
  });
}
