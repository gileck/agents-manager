import type { Pipeline, PipelineCreateInput, PipelineUpdateInput } from '../../shared/types';

export interface TransitionRecord {
  id: string;
  taskId: string;
  fromStatus: string;
  toStatus: string;
  trigger: string;
  actor: string | null;
  guardResults: Record<string, unknown>;
  createdAt: number;
  correlationId?: string;
}

export interface IPipelineStore {
  getPipeline(id: string): Promise<Pipeline | null>;
  listPipelines(): Promise<Pipeline[]>;
  createPipeline(input: PipelineCreateInput): Promise<Pipeline>;
  updatePipeline(id: string, input: PipelineUpdateInput): Promise<Pipeline | null>;
  deletePipeline(id: string): Promise<boolean>;
  getPipelineForTaskType(taskType: string): Promise<Pipeline | null>;
  recordTransitionSync(record: TransitionRecord): void;
  getLastFromStatusSync(taskId: string): string | null;
  countSelfLoopTransitionsSync(taskId: string, fromStatus: string, toStatus: string): number;
}
