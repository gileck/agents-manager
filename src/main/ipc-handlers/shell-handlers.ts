import { shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';

export function registerShellHandlers(): void {
  registerIpcHandler(IPC_CHANNELS.OPEN_IN_CHROME, async (_, url: string) => {
    // Validate URL to prevent command injection
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    if (process.platform === 'darwin') {
      const { execFile: execFileCb } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFileCb);
      await execFileAsync('open', ['-a', 'Google Chrome', url]);
    } else {
      await shell.openExternal(url);
    }
  });

  registerIpcHandler(IPC_CHANNELS.OPEN_IN_ITERM, async (_, dirPath: string) => {
    if (!dirPath || typeof dirPath !== 'string') throw new Error('Invalid directory path');
    const { isAbsolute } = await import('path');
    if (!isAbsolute(dirPath)) throw new Error('Path must be absolute');
    const { existsSync } = await import('fs');
    if (!existsSync(dirPath)) throw new Error(`Directory does not exist: ${dirPath}`);
    const { execFile: execFileCb } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFileCb);
    const env = (await import('../../shared/shell-env')).getShellEnv();
    const script = `
      on run argv
        set dirPath to item 1 of argv
        tell application "iTerm"
          activate
          set newWindow to (create window with default profile)
          tell current session of newWindow
            write text "cd " & quoted form of dirPath
          end tell
        end tell
      end run
    `;
    await execFileAsync('osascript', ['-e', script, dirPath], { env });
  });

  registerIpcHandler(IPC_CHANNELS.OPEN_IN_VSCODE, async (_, dirPath: string) => {
    if (!dirPath || typeof dirPath !== 'string') throw new Error('Invalid directory path');
    const { isAbsolute } = await import('path');
    if (!isAbsolute(dirPath)) throw new Error('Path must be absolute');
    const { existsSync } = await import('fs');
    if (!existsSync(dirPath)) throw new Error(`Directory does not exist: ${dirPath}`);
    const { execFile: execFileCb } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFileCb);
    const env = (await import('../../shared/shell-env')).getShellEnv();
    await execFileAsync('code', [dirPath], { env });
  });

  registerIpcHandler(IPC_CHANNELS.OPEN_FILE_IN_VSCODE, async (_, filePath: string, line?: number) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('Invalid file path');
    const { isAbsolute } = await import('path');
    if (!isAbsolute(filePath)) throw new Error('Path must be absolute');
    if (line !== undefined && (typeof line !== 'number' || !Number.isFinite(line) || line < 1)) {
      throw new Error(`Invalid line number: ${line}`);
    }
    const { existsSync } = await import('fs');
    if (!existsSync(filePath)) throw new Error(`File does not exist: ${filePath}`);
    const { execFile: execFileCb } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFileCb);
    const env = (await import('../../shared/shell-env')).getShellEnv();
    const target = line ? `${filePath}:${line}` : filePath;
    await execFileAsync('code', ['--goto', target], { env });
  });
}
