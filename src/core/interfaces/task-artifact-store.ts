import type { TaskArtifact, TaskArtifactCreateInput, ArtifactType } from '../../shared/types';

export interface ITaskArtifactStore {
  createArtifact(input: TaskArtifactCreateInput): Promise<TaskArtifact>;
  getArtifactsForTask(taskId: string, type?: ArtifactType): Promise<TaskArtifact[]>;
  deleteArtifactsForTask(taskId: string): Promise<number>;
}
