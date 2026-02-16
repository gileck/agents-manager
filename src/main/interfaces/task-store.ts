import type { Task, TaskCreateInput, TaskUpdateInput, TaskFilter } from '../../shared/types';

export interface ITaskStore {
  getTask(id: string): Promise<Task | null>;
  listTasks(filter?: TaskFilter): Promise<Task[]>;
  createTask(input: TaskCreateInput): Promise<Task>;
  updateTask(id: string, input: TaskUpdateInput): Promise<Task | null>;
  deleteTask(id: string): Promise<boolean>;
  addDependency(taskId: string, dependsOnTaskId: string): Promise<void>;
  removeDependency(taskId: string, dependsOnTaskId: string): Promise<void>;
  getDependencies(taskId: string): Promise<Task[]>;
  getDependents(taskId: string): Promise<Task[]>;
}
