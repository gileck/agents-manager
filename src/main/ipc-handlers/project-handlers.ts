import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import { type ApiClient, ApiError } from '../../client';
import type { ProjectCreateInput, ProjectUpdateInput } from '../../shared/types';

export function registerProjectHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.PROJECT_LIST, async () => {
    return api.projects.list();
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_GET, async (_, id: string) => {
    try {
      return await api.projects.get(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_CREATE, async (_, input: ProjectCreateInput) => {
    return api.projects.create(input);
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_UPDATE, async (_, id: string, input: ProjectUpdateInput) => {
    return api.projects.update(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_DELETE, async (_, id: string) => {
    return api.projects.delete(id);
  });
}
