import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { FeatureCreateInput, FeatureUpdateInput, FeatureFilter } from '../../shared/types';

export function registerFeatureHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.FEATURE_LIST, async (_, filter?: FeatureFilter) => {
    return api.features.list(filter);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_GET, async (_, id: string) => {
    return api.features.get(id);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_CREATE, async (_, input: FeatureCreateInput) => {
    return api.features.create(input);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_UPDATE, async (_, id: string, input: FeatureUpdateInput) => {
    return api.features.update(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_DELETE, async (_, id: string) => {
    return api.features.delete(id);
  });
}
