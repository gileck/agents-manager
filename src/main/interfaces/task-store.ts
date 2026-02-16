import type { Task, TaskCreateInput, TaskUpdateInput, TaskFilter, TaskDependency } from '../../shared/types';

export interface ITaskStore {
  getTask(id: string): Task | null;
  listTasks(filter?: TaskFilter): Task[];
  createTask(input: TaskCreateInput): Task;
  updateTask(id: string, input: TaskUpdateInput): Task | null;
  deleteTask(id: string): boolean;
  addDependency(taskId: string, dependsOnTaskId: string): void;
  removeDependency(taskId: string, dependsOnTaskId: string): void;
  getDependencies(taskId: string): Task[];
  getDependents(taskId: string): Task[];
}
