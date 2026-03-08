import * as path from 'path';
import type { ApiClient } from '../client/api-client';
import type { Project } from '../shared/types';

export async function resolveProject(
  api: ApiClient,
  flagProjectId?: string,
): Promise<Project | null> {
  // 1. Explicit --project flag
  if (flagProjectId) {
    try {
      return await api.projects.get(flagProjectId);
    } catch {
      throw new Error(`Project not found: ${flagProjectId}`);
    }
  }

  // 2. AM_PROJECT_ID env var
  const envId = process.env.AM_PROJECT_ID;
  if (envId) {
    try {
      return await api.projects.get(envId);
    } catch {
      throw new Error(`Project not found (AM_PROJECT_ID): ${envId}`);
    }
  }

  // 3. Match cwd against known project paths
  const cwd = process.cwd();
  const projects = await api.projects.list();
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
  api: ApiClient,
  flagProjectId?: string,
): Promise<Project> {
  const project = await resolveProject(api, flagProjectId);
  if (!project) {
    const projects = await api.projects.list();
    const list = projects.length > 0
      ? projects.map((p) => `  ${p.id}  ${p.name}${p.path ? `  (${p.path})` : ''}`).join('\n')
      : '  (none)';
    throw new Error(
      `No project detected. Use --project <id>, set AM_PROJECT_ID, or cd into a project directory.\n\nKnown projects:\n${list}`,
    );
  }
  return project;
}

export async function resolveTaskId(api: ApiClient, input: string): Promise<string> {
  // Fast path: full UUID — return immediately without an API call
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    return input;
  }

  // Prefix match against the first segment (first 8 hex chars before the first dash)
  const tasks = await api.tasks.list({});
  const matches = tasks.filter((t) => t.id.split('-')[0] === input);

  if (matches.length === 0) {
    throw new Error(`Task not found: ${input}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous ID, ${matches.length} matches found`);
  }

  process.stderr.write(`Resolved ${input} → ${matches[0].id}\n`);
  return matches[0].id;
}
