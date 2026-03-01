import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import type { AppServices } from '../../core/providers/setup';
import type { FeatureCreateInput, FeatureUpdateInput, FeatureFilter } from '../../shared/types';

export function registerFeatureHandlers(services: AppServices): void {
  registerIpcHandler(IPC_CHANNELS.FEATURE_LIST, async (_, filter?: FeatureFilter) => {
    return services.featureStore.listFeatures(filter);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_GET, async (_, id: string) => {
    validateId(id);
    return services.featureStore.getFeature(id);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_CREATE, async (_, input: FeatureCreateInput) => {
    validateInput(input, ['projectId', 'title']);
    return services.featureStore.createFeature(input);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_UPDATE, async (_, id: string, input: FeatureUpdateInput) => {
    validateId(id);
    return services.featureStore.updateFeature(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.FEATURE_DELETE, async (_, id: string) => {
    validateId(id);
    return services.featureStore.deleteFeature(id);
  });
}
