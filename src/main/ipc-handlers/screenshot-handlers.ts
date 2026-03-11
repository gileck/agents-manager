import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { ChatImage } from '../../shared/types';

export function registerScreenshotHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.SCREENSHOT_SAVE, async (_, images: ChatImage[]) =>
    api.screenshots.save(images));
}
