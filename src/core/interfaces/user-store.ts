import type { User } from '../../shared/types';

/**
 * Internal user store — not exposed via IPC.
 *
 * Reserved for future multi-user support. Currently unused by any IPC
 * handler; all access should go through WorkflowService if/when user
 * management is surfaced to the UI.
 */
export interface IUserStore {
  getUser(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(username: string, role: 'admin' | 'user'): Promise<User>;
  updateUserRole(id: string, role: 'admin' | 'user'): Promise<User | null>;
  deleteUser(id: string): Promise<boolean>;
}