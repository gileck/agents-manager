import type { Project, ProjectCreateInput, ProjectUpdateInput } from '../../shared/types';

export interface IProjectStore {
  getProject(id: string): Project | null;
  listProjects(): Project[];
  createProject(input: ProjectCreateInput): Project;
  updateProject(id: string, input: ProjectUpdateInput): Project | null;
  deleteProject(id: string): boolean;
}
