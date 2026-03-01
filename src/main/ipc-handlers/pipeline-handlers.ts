import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';

export function registerPipelineHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.PIPELINE_LIST, async () => {
    return api.pipelines.list();
  });

  registerIpcHandler(IPC_CHANNELS.PIPELINE_GET, async (_, id: string) => {
    return api.pipelines.get(id);
  });
}
