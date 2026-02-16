import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, resetCounters } from '../helpers/factories';

describe('Project CRUD', () => {
  let ctx: TestContext;

  beforeEach(() => {
    resetCounters();
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should create a project', () => {
    const input = createProjectInput();
    const project = ctx.projectStore.createProject(input);

    expect(project.id).toBeDefined();
    expect(project.name).toBe(input.name);
    expect(project.description).toBe(input.description!);
    expect(project.config).toEqual({});
    expect(project.createdAt).toBeGreaterThan(0);
    expect(project.updatedAt).toBeGreaterThan(0);
  });

  it('should get a project by id', () => {
    const project = ctx.projectStore.createProject(createProjectInput());
    const fetched = ctx.projectStore.getProject(project.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(project.id);
    expect(fetched!.name).toBe(project.name);
  });

  it('should return null for non-existent project', () => {
    const result = ctx.projectStore.getProject('non-existent-id');
    expect(result).toBeNull();
  });

  it('should list all projects', () => {
    ctx.projectStore.createProject(createProjectInput());
    ctx.projectStore.createProject(createProjectInput());
    ctx.projectStore.createProject(createProjectInput());

    const projects = ctx.projectStore.listProjects();
    expect(projects).toHaveLength(3);
  });

  it('should update a project', () => {
    const project = ctx.projectStore.createProject(createProjectInput());
    const updated = ctx.projectStore.updateProject(project.id, {
      name: 'Updated Name',
      config: { key: 'value' },
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.config).toEqual({ key: 'value' });
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(project.updatedAt);
  });

  it('should return null when updating non-existent project', () => {
    const result = ctx.projectStore.updateProject('non-existent-id', { name: 'test' });
    expect(result).toBeNull();
  });

  it('should delete a project', () => {
    const project = ctx.projectStore.createProject(createProjectInput());
    const deleted = ctx.projectStore.deleteProject(project.id);

    expect(deleted).toBe(true);
    expect(ctx.projectStore.getProject(project.id)).toBeNull();
  });

  it('should return false when deleting non-existent project', () => {
    const result = ctx.projectStore.deleteProject('non-existent-id');
    expect(result).toBe(false);
  });

  it('should create a project with custom config', () => {
    const input = createProjectInput({ config: { repo: 'test/repo', branch: 'main' } });
    const project = ctx.projectStore.createProject(input);

    expect(project.config).toEqual({ repo: 'test/repo', branch: 'main' });
  });

  it('should create a project with path', () => {
    const input = createProjectInput({ path: '/home/user/project' });
    const project = ctx.projectStore.createProject(input);

    expect(project.path).toBe('/home/user/project');
  });
});
