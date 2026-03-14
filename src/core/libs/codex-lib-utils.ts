import type { PermissionMode } from '../../shared/types';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export function resolveSandboxMode(
  permissionMode: PermissionMode | undefined,
  readOnly: boolean,
): SandboxMode {
  switch (permissionMode) {
    case 'full_access':
      return 'danger-full-access';
    case 'read_write':
      return 'workspace-write';
    case 'read_only':
      return 'read-only';
    default:
      return readOnly ? 'read-only' : 'workspace-write';
  }
}
