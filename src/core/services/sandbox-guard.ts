import { realpathSync } from 'fs';
import { isAbsolute, resolve } from 'path';

const SENSITIVE_PATTERNS = [
  '/.ssh',
  '/.aws',
  '/.gnupg',
  '/.config',
  '/etc',
  '.env',
];

/** Regex to extract file paths from bash commands that accept path arguments. */
const BASH_PATH_REGEX = /(?:^|\s)(?:cat|less|head|tail|rm|mv|cp|mkdir|touch|chmod|chown|find|ls|>|>>)\s+["']?([^\s"'|;&]+)/g;
const BASH_CD_REGEX = /(?:^|\s)cd\s+["']?([^\s"'|;&]+)/g;
/** Supplementary regex: captures any absolute paths (starting with /) anywhere in the command.
 *  This ensures paths appearing after flags (e.g., `ls -la /var/secret`) are still checked. */
const BASH_ABSOLUTE_PATH_REGEX = /(?:^|\s)(\/[^\s"'|;&]+)/g;

export class SandboxGuard {
  private resolvedAllowed: string[];
  private resolvedReadOnly: string[];
  private readonly cwd: string;

  constructor(allowedPaths: string[], readOnlyPaths: string[] = [], cwd?: string) {
    this.cwd = cwd ?? process.cwd();
    this.resolvedAllowed = allowedPaths.map(p => this.safeRealpath(p));
    this.resolvedReadOnly = readOnlyPaths.map(p => this.safeRealpath(p));
  }

  evaluateToolCall(toolName: string, toolInput: Record<string, unknown>): { allow: boolean; reason?: string } {
    try {
      switch (toolName) {
        case 'Write':
        case 'Edit':
        case 'MultiEdit':
          return this.checkWritePath(toolInput.file_path as string | undefined);

        case 'NotebookEdit':
          return this.checkWritePath(toolInput.notebook_path as string | undefined);

        case 'Read':
        case 'Glob':
        case 'Grep':
          return this.checkReadPath(this.extractPathFromInput(toolInput));

        case 'Bash': {
          const command = toolInput.command as string | undefined;
          if (!command) return { allow: true };
          return this.checkBashCommand(command);
        }

        default:
          return { allow: true };
      }
    } catch (err) {
      // Fail-closed: any error in guard evaluation blocks the tool call
      return { allow: false, reason: `Sandbox guard error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private checkWritePath(filePath: string | undefined): { allow: boolean; reason?: string } {
    if (!filePath) return { allow: true };

    if (this.isSensitivePath(filePath)) {
      return { allow: false, reason: `Write to sensitive path blocked: ${filePath}` };
    }

    const resolved = this.safeRealpath(filePath);
    if (!this.isWithinAllowed(resolved)) {
      return { allow: false, reason: `Write outside allowed paths: ${filePath}` };
    }

    return { allow: true };
  }

  private checkReadPath(filePath: string | undefined): { allow: boolean; reason?: string } {
    if (!filePath) return { allow: true };

    if (this.isSensitivePath(filePath)) {
      return { allow: false, reason: `Read of sensitive path blocked: ${filePath}` };
    }

    const resolved = this.safeRealpath(filePath);
    if (!this.isWithinAllowed(resolved) && !this.isWithinReadOnly(resolved)) {
      return { allow: false, reason: `Read outside allowed paths: ${filePath}` };
    }

    return { allow: true };
  }

  private checkBashCommand(command: string): { allow: boolean; reason?: string } {
    const pathSet = new Set<string>();

    // Extract paths from common file-manipulating commands
    let match: RegExpExecArray | null;
    const pathRegex = new RegExp(BASH_PATH_REGEX.source, 'g');
    while ((match = pathRegex.exec(command)) !== null) {
      pathSet.add(match[1]);
    }

    const cdRegex = new RegExp(BASH_CD_REGEX.source, 'g');
    while ((match = cdRegex.exec(command)) !== null) {
      pathSet.add(match[1]);
    }

    // Also extract absolute paths anywhere in the command (catches paths after flags)
    const absPathRegex = new RegExp(BASH_ABSOLUTE_PATH_REGEX.source, 'g');
    while ((match = absPathRegex.exec(command)) !== null) {
      pathSet.add(match[1]);
    }

    // If no paths extracted, allow (conservative — most bash commands are safe)
    if (pathSet.size === 0) return { allow: true };

    for (const p of pathSet) {
      // Skip command flags (arguments starting with -)
      if (p.startsWith('-')) {
        continue;
      }

      if (this.isSensitivePath(p)) {
        return { allow: false, reason: `Bash command accesses sensitive path: ${p}` };
      }
      const resolved = this.safeRealpath(p);
      if (!this.isWithinAllowed(resolved) && !this.isWithinReadOnly(resolved)) {
        return { allow: false, reason: `Bash command accesses path outside boundaries: ${p}` };
      }
    }

    return { allow: true };
  }

  private extractPathFromInput(toolInput: Record<string, unknown>): string | undefined {
    return (toolInput.file_path ?? toolInput.path ?? toolInput.directory) as string | undefined;
  }

  private isSensitivePath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return SENSITIVE_PATTERNS.some(pattern => normalized.includes(pattern));
  }

  private isWithinAllowed(resolved: string): boolean {
    return this.resolvedAllowed.some(allowed => resolved.startsWith(allowed + '/') || resolved === allowed);
  }

  private isWithinReadOnly(resolved: string): boolean {
    return this.resolvedReadOnly.some(ro => resolved.startsWith(ro + '/') || resolved === ro);
  }

  private safeRealpath(p: string): string {
    try {
      const resolved = isAbsolute(p) ? p : resolve(this.cwd, p);
      return realpathSync(resolved);
    } catch {
      // Path may not exist yet (e.g., Write to new file) — resolve without symlink resolution
      return isAbsolute(p) ? resolve(p) : resolve(this.cwd, p);
    }
  }
}
