import * as path from 'path';
import type { AppServices } from '../main/providers/setup';
import type { Project } from '../shared/types';

export async function resolveProject(
  services: AppServices,
  flagProjectId?: string,
): Promise<Project | null> {
  // 1. Explicit --project flag
  if (flagProjectId) {
    const project = await services.projectStore.getProject(flagProjectId);
    if (!project) {
      throw new Error(`Project not found: ${flagProjectId}`);
    }
    return project;
  }

  // 2. AM_PROJECT_ID env var
  const envId = process.env.AM_PROJECT_ID;
  if (envId) {
    const project = await services.projectStore.getProject(envId);
    if (!project) {
      throw new Error(`Project not found (AM_PROJECT_ID): ${envId}`);
    }
    return project;
  }

  // 3. Match cwd against known project paths
  const cwd = process.cwd();
  const projects = await services.projectStore.listProjects();
  for (const project of projects) {
    if (project.path) {
      const resolved = path.resolve(project.path);
      if (cwd === resolved || cwd.startsWith(resolved + path.sep)) {
        return project;
      }
    }
  }

  return null;
}

export async function requireProject(
  services: AppServices,
  flagProjectId?: string,
): Promise<Project> {
  const project = await resolveProject(services, flagProjectId);
  if (!project) {
    const projects = await services.projectStore.listProjects();
    const list = projects.length > 0
      ? projects.map((p) => `  ${p.id}  ${p.name}${p.path ? `  (${p.path})` : ''}`).join('\n')
      : '  (none)';
    throw new Error(
      `No project detected. Use --project <id>, set AM_PROJECT_ID, or cd into a project directory.\n\nKnown projects:\n${list}`,
    );
  }
  return project;
}
