import type { Pipeline, PipelineCreateInput, PipelineUpdateInput } from '../../shared/types';

export interface IPipelineStore {
  getPipeline(id: string): Pipeline | null;
  listPipelines(): Pipeline[];
  createPipeline(input: PipelineCreateInput): Pipeline;
  updatePipeline(id: string, input: PipelineUpdateInput): Pipeline | null;
  deletePipeline(id: string): boolean;
  getPipelineForTaskType(taskType: string): Pipeline | null;
}
