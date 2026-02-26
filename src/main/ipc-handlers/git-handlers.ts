import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId } from '@template/main/ipc/ipc-registry';
import { LocalGitOps } from '../services/local-git-ops';
import type { AppServices } from '../providers/setup';
import type { GitLogEntry, GitCommitDetail } from '../../shared/types';
import type { IGitOps } from '../interfaces/git-ops';

async function getTaskGitOps(services: AppServices, taskId: string): Promise<LocalGitOps | null> {
  const task = await services.taskStore.getTask(taskId);
  if (!task) return null;
  const project = await services.projectStore.getProject(task.projectId);
  if (!project?.path) return null;
  const wm = services.createWorktreeManager(project.path);
  const worktree = await wm.get(taskId);
  if (!worktree) return null;
  return new LocalGitOps(worktree.path);
}

async function withProjectGit<T>(services: AppServices, projectId: string, fallback: T, fn: (git: IGitOps) => Promise<T>): Promise<T> {
  validateId(projectId);
  const project = await services.projectStore.getProject(projectId);
  if (!project?.path) return fallback;
  return fn(services.createGitOps(project.path));
}

export function registerGitHandlers(services: AppServices): void {
  // ============================================
  // Git Operations (task-scoped)
  // ============================================

  registerIpcHandler(IPC_CHANNELS.GIT_DIFF, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(services, taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.diff('origin/main');
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_STAT, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(services, taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.diffStat('origin/main');
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_WORKING_DIFF, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(services, taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.diff('HEAD');
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_STATUS, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(services, taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.status();
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_RESET_FILE, async (_, taskId: string, filepath: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(services, taskId);
    if (!gitOps) throw new Error('No worktree for task');
    await gitOps.resetFile(filepath);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_CLEAN, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(services, taskId);
    if (!gitOps) throw new Error('No worktree for task');
    await gitOps.clean();
  });

  registerIpcHandler(IPC_CHANNELS.GIT_PULL, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(services, taskId);
    if (!gitOps) throw new Error('No worktree for task');
    const branch = await gitOps.getCurrentBranch();
    await gitOps.pull(branch);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_LOG, async (_, taskId: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(services, taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.log();
    } catch {
      return null;
    }
  });

  registerIpcHandler(IPC_CHANNELS.GIT_SHOW, async (_, taskId: string, hash: string) => {
    validateId(taskId);
    const gitOps = await getTaskGitOps(services, taskId);
    if (!gitOps) return null;
    try {
      return await gitOps.showCommit(hash);
    } catch {
      return null;
    }
  });

  // ============================================
  // Source Control Operations (project-scoped)
  // ============================================

  registerIpcHandler(IPC_CHANNELS.GIT_PROJECT_LOG, async (_, projectId: string, count?: number): Promise<GitLogEntry[]> => {
    return withProjectGit(services, projectId, [], (git) => git.log(count ?? 50));
  });

  registerIpcHandler(IPC_CHANNELS.GIT_BRANCH, async (_, projectId: string): Promise<string> => {
    return withProjectGit(services, projectId, '', (git) => git.getCurrentBranch());
  });

  registerIpcHandler(IPC_CHANNELS.GIT_COMMIT_DETAIL, async (_, projectId: string, hash: string): Promise<GitCommitDetail> => {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
      throw new Error('Invalid commit hash');
    }
    return withProjectGit(services, projectId, { hash, body: '', files: [] }, (git) => git.getCommitDetail(hash));
  });
}
