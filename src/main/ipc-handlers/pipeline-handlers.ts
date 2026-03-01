import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId } from '@template/main/ipc/ipc-registry';
import type { AppServices } from '../../core/providers/setup';

export function registerPipelineHandlers(services: AppServices): void {
  registerIpcHandler(IPC_CHANNELS.PIPELINE_LIST, async () => {
    return services.pipelineStore.listPipelines();
  });

  registerIpcHandler(IPC_CHANNELS.PIPELINE_GET, async (_, id: string) => {
    validateId(id);
    return services.pipelineStore.getPipeline(id);
  });
}
