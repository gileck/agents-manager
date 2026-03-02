import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { AppDebugLogFilter } from '../../shared/types';

export function registerDebugLogHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.DEBUG_LOG_LIST, async (_, filter?: AppDebugLogFilter) => {
    return api.debugLogs.list(filter);
  });

  registerIpcHandler(IPC_CHANNELS.DEBUG_LOG_CLEAR, async (_, olderThanMs?: number) => {
    return api.debugLogs.clear(olderThanMs);
  });
}
