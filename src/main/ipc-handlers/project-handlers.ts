import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import type { AppServices } from '../providers/setup';
import type { ProjectCreateInput, ProjectUpdateInput } from '../../shared/types';

export function registerProjectHandlers(services: AppServices): void {
  registerIpcHandler(IPC_CHANNELS.PROJECT_LIST, async () => {
    return services.projectStore.listProjects();
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_GET, async (_, id: string) => {
    validateId(id);
    return services.projectStore.getProject(id);
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_CREATE, async (_, input: ProjectCreateInput) => {
    validateInput(input, ['name']);
    return services.projectStore.createProject(input);
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_UPDATE, async (_, id: string, input: ProjectUpdateInput) => {
    validateId(id);
    return services.projectStore.updateProject(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.PROJECT_DELETE, async (_, id: string) => {
    validateId(id);
    return services.projectStore.deleteProject(id);
  });
}
