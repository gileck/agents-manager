import type { Pipeline, PipelineCreateInput, PipelineUpdateInput } from '../../shared/types';

export interface IPipelineStore {
  getPipeline(id: string): Promise<Pipeline | null>;
  listPipelines(): Promise<Pipeline[]>;
  createPipeline(input: PipelineCreateInput): Promise<Pipeline>;
  updatePipeline(id: string, input: PipelineUpdateInput): Promise<Pipeline | null>;
  deletePipeline(id: string): Promise<boolean>;
  getPipelineForTaskType(taskType: string): Promise<Pipeline | null>;
}
