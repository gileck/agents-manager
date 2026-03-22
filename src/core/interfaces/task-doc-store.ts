import type { TaskDoc, TaskDocCreateInput, DocArtifactType } from '../../shared/types';

export interface ITaskDocStore {
  upsert(input: TaskDocCreateInput): Promise<TaskDoc>;
  getByTaskId(taskId: string): Promise<TaskDoc[]>;
  getByTaskIdAndType(taskId: string, type: DocArtifactType): Promise<TaskDoc | null>;
  deleteByTaskId(taskId: string): Promise<void>;
}
