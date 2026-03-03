import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';

export function registerGitHandlers(api: ApiClient): void {
  // ============================================
  // Git Operations (task-scoped)
  // ============================================

  registerIpcHandler(IPC_CHANNELS.GIT_DIFF, async (_, taskId: string) => {
    const result = await api.git.getDiff(taskId);
    return result?.diff ?? null;
  });

  registerIpcHandler(IPC_CHANNELS.GIT_STAT, async (_, taskId: string) => {
    return api.git.getStat(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_WORKING_DIFF, async (_, taskId: string) => {
    const result = await api.git.getWorkingDiff(taskId);
    return result?.diff ?? null;
  });

  registerIpcHandler(IPC_CHANNELS.GIT_STATUS, async (_, taskId: string) => {
    const result = await api.git.getStatus(taskId);
    return result?.status ?? null;
  });

  registerIpcHandler(IPC_CHANNELS.GIT_RESET_FILE, async (_, taskId: string, filepath: string) => {
    return api.git.resetFile(taskId, filepath);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_CLEAN, async (_, taskId: string) => {
    return api.git.clean(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_PULL, async (_, taskId: string) => {
    return api.git.pull(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_LOG, async (_, taskId: string) => {
    return api.git.getLog(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_SHOW, async (_, taskId: string, hash: string) => {
    return api.git.showCommit(taskId, hash);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_PR_CHECKS, async (_, taskId: string) => {
    return api.git.getPRChecks(taskId);
  });

  // ============================================
  // Source Control Operations (project-scoped)
  // ============================================

  registerIpcHandler(IPC_CHANNELS.GIT_PROJECT_LOG, async (_, projectId: string, count?: number) => {
    return api.git.getProjectLog(projectId, count);
  });

  registerIpcHandler(IPC_CHANNELS.GIT_BRANCH, async (_, projectId: string) => {
    const result = await api.git.getProjectBranch(projectId);
    // The daemon returns { branch: string }, but the old IPC returned just the string
    return result.branch;
  });

  registerIpcHandler(IPC_CHANNELS.GIT_COMMIT_DETAIL, async (_, projectId: string, hash: string) => {
    return api.git.getProjectCommit(projectId, hash);
  });
}
