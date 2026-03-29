import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ApiClient } from '../../client/api-client';

export function registerTerminalHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.TERMINAL_CREATE, async (_, projectId: string, name: string, cwd: string, type: string) => {
    return api.terminals.create(projectId, name, cwd, type || 'blank');
  });

  registerIpcHandler(IPC_CHANNELS.TERMINAL_LIST, async () => {
    return api.terminals.list();
  });

  registerIpcHandler(IPC_CHANNELS.TERMINAL_WRITE, async (_, terminalId: string, data: string) => {
    return api.terminals.write(terminalId, data);
  });

  registerIpcHandler(IPC_CHANNELS.TERMINAL_RESIZE, async (_, terminalId: string, cols: number, rows: number) => {
    return api.terminals.resize(terminalId, cols, rows);
  });

  registerIpcHandler(IPC_CHANNELS.TERMINAL_CLOSE, async (_, terminalId: string) => {
    return api.terminals.close(terminalId);
  });
}
