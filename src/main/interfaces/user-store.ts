import type { User } from '../../shared/types';

export interface IUserStore {
  getUser(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(username: string, role: 'admin' | 'user'): Promise<User>;
  updateUserRole(id: string, role: 'admin' | 'user'): Promise<User | null>;
  deleteUser(id: string): Promise<boolean>;
}