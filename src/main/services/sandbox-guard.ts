import { realpathSync } from 'fs';
import { resolve } from 'path';

const SENSITIVE_PATTERNS = [
  '/.ssh',
  '/.aws',
  '/.gnupg',
  '/.config',
  '/etc',
  '.env',
];

/** Regex to extract file paths from common bash commands. */
const BASH_PATH_REGEX = /(?:^|\s)(?:cat|less|head|tail|rm|mv|cp|mkdir|touch|chmod|chown|>|>>)\s+["']?([^\s"'|;&]+)/g;
const BASH_CD_REGEX = /(?:^|\s)cd\s+["']?([^\s"'|;&]+)/g;

export class SandboxGuard {
  private resolvedAllowed: string[];
  private resolvedReadOnly: string[];

  constructor(allowedPaths: string[], readOnlyPaths: string[] = []) {
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
    const paths: string[] = [];

    // Extract paths from common file-manipulating commands
    let match: RegExpExecArray | null;
    const pathRegex = new RegExp(BASH_PATH_REGEX.source, 'g');
    while ((match = pathRegex.exec(command)) !== null) {
      paths.push(match[1]);
    }

    const cdRegex = new RegExp(BASH_CD_REGEX.source, 'g');
    while ((match = cdRegex.exec(command)) !== null) {
      paths.push(match[1]);
    }

    // If no paths extracted, allow (conservative — most bash commands are safe)
    if (paths.length === 0) return { allow: true };

    for (const p of paths) {
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
      return realpathSync(resolve(p));
    } catch {
      // Path may not exist yet (e.g., Write to new file) — resolve without symlink resolution
      return resolve(p);
    }
  }
}
