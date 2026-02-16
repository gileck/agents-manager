import type { TaskPhase, TaskPhaseCreateInput, TaskPhaseUpdateInput } from '../../shared/types';

export interface ITaskPhaseStore {
  createPhase(input: TaskPhaseCreateInput): Promise<TaskPhase>;
  updatePhase(id: string, input: TaskPhaseUpdateInput): Promise<TaskPhase | null>;
  getPhasesForTask(taskId: string): Promise<TaskPhase[]>;
  getActivePhase(taskId: string): Promise<TaskPhase | null>;
}
