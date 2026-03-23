import * as path from 'path';
import * as os from 'os';

/** Base directory for all user-specific data: ~/.agents-manager/ */
export function getUserDataDir(): string {
  return path.join(process.env.HOME || os.homedir(), '.agents-manager');
}

/** Directory for screenshot storage: ~/.agents-manager/screenshots/ */
export function getScreenshotStorageDir(): string {
  return path.join(getUserDataDir(), 'screenshots');
}

/** Directory for chat image storage: ~/.agents-manager/chat-images/ */
export function getChatImagesStorageDir(): string {
  return path.join(getUserDataDir(), 'chat-images');
}

/**
 * Returns paths under ~/.agents-manager/ that agents should be allowed
 * to read (but not write). This enables sandbox-restricted agents to
 * access screenshots and chat images referenced in task descriptions.
 */
export function getGlobalAgentReadOnlyPaths(): string[] {
  return [
    getScreenshotStorageDir(),
    getChatImagesStorageDir(),
  ];
}
