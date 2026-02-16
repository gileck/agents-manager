import type { Project, ProjectCreateInput, ProjectUpdateInput } from '../../shared/types';

export interface IProjectStore {
  getProject(id: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  createProject(input: ProjectCreateInput): Promise<Project>;
  updateProject(id: string, input: ProjectUpdateInput): Promise<Project | null>;
  deleteProject(id: string): Promise<boolean>;
}
