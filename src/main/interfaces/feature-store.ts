import type { Feature, FeatureCreateInput, FeatureUpdateInput, FeatureFilter } from '../../shared/types';

export interface IFeatureStore {
  getFeature(id: string): Promise<Feature | null>;
  listFeatures(filter?: FeatureFilter): Promise<Feature[]>;
  createFeature(input: FeatureCreateInput): Promise<Feature>;
  updateFeature(id: string, input: FeatureUpdateInput): Promise<Feature | null>;
  deleteFeature(id: string): Promise<boolean>;
}
