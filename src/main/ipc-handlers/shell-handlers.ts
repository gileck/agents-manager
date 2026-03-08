import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';

export function registerShellHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.OPEN_IN_CHROME, async (_, url: string) =>
    api.shell.openInChrome(url));

  registerIpcHandler(IPC_CHANNELS.OPEN_IN_ITERM, async (_, dirPath: string) =>
    api.shell.openInIterm(dirPath));

  registerIpcHandler(IPC_CHANNELS.OPEN_IN_VSCODE, async (_, dirPath: string) =>
    api.shell.openInVscode(dirPath));

  registerIpcHandler(IPC_CHANNELS.OPEN_FILE_IN_VSCODE, async (_, filePath: string, line?: number) =>
    api.shell.openFileInVscode(filePath, line));

  registerIpcHandler(IPC_CHANNELS.DIALOG_PICK_FOLDER, async () =>
    api.shell.pickFolder());
}
