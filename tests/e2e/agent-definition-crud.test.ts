import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createAgentDefinitionInput, resetCounters } from '../helpers/factories';

describe('Agent Definition CRUD', () => {
  let ctx: TestContext;

  beforeEach(() => {
    resetCounters();
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should list built-in definitions', async () => {
    const defs = await ctx.agentDefinitionStore.listDefinitions();

    expect(defs.length).toBeGreaterThanOrEqual(2);
    const builtIn = defs.filter(d => d.isBuiltIn);
    expect(builtIn.length).toBeGreaterThanOrEqual(2);

    const implementor = builtIn.find(d => d.id === 'agent-def-claude-code');
    expect(implementor).toBeDefined();
    expect(implementor!.name).toBe('Implementor');

    const reviewer = builtIn.find(d => d.id === 'agent-def-pr-reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer!.name).toBe('PR Reviewer');
  });

  it('should get a definition by ID', async () => {
    const def = await ctx.agentDefinitionStore.getDefinition('agent-def-claude-code');

    expect(def).not.toBeNull();
    expect(def!.id).toBe('agent-def-claude-code');
    expect(def!.engine).toBe('claude-code');
    expect(def!.isBuiltIn).toBe(true);
    expect(Array.isArray(def!.modes)).toBe(true);
    expect(def!.modes.length).toBeGreaterThan(0);
    expect(def!.modes[0]).toHaveProperty('mode');
    expect(def!.modes[0]).toHaveProperty('promptTemplate');
  });

  it('should get a definition by agent type', async () => {
    const def = await ctx.agentDefinitionStore.getDefinitionByAgentType('claude-code');

    expect(def).not.toBeNull();
    expect(def!.id).toBe('agent-def-claude-code');
  });

  it('should return null for non-existent agent type', async () => {
    const def = await ctx.agentDefinitionStore.getDefinitionByAgentType('non-existent');
    expect(def).toBeNull();
  });

  it('should get a definition by mode', async () => {
    const def = await ctx.agentDefinitionStore.getDefinitionByMode('review');

    expect(def).not.toBeNull();
    expect(def!.id).toBe('agent-def-pr-reviewer');
  });

  it('should create a custom definition', async () => {
    const input = createAgentDefinitionInput({
      name: 'My Custom Agent',
      description: 'Does custom things',
      model: 'gpt-4',
    });
    const def = await ctx.agentDefinitionStore.createDefinition(input);

    expect(def.id).toBeDefined();
    expect(def.name).toBe('My Custom Agent');
    expect(def.description).toBe('Does custom things');
    expect(def.engine).toBe('claude-code');
    expect(def.model).toBe('gpt-4');
    expect(def.isBuiltIn).toBe(false);
    expect(def.modes).toEqual(input.modes);
    expect(def.createdAt).toBeGreaterThan(0);
  });

  it('should update definition fields', async () => {
    const created = await ctx.agentDefinitionStore.createDefinition(createAgentDefinitionInput());
    const newModes = [{ mode: 'implement', promptTemplate: 'Implement: {taskTitle}' }];

    const updated = await ctx.agentDefinitionStore.updateDefinition(created.id, {
      name: 'Updated Agent',
      modes: newModes,
      model: 'claude-3',
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated Agent');
    expect(updated!.modes).toEqual(newModes);
    expect(updated!.model).toBe('claude-3');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('should clear model with null', async () => {
    const created = await ctx.agentDefinitionStore.createDefinition(
      createAgentDefinitionInput({ model: 'some-model' }),
    );
    expect(created.model).toBe('some-model');

    const updated = await ctx.agentDefinitionStore.updateDefinition(created.id, { model: null });

    expect(updated).not.toBeNull();
    expect(updated!.model).toBeNull();
  });

  it('should delete a custom definition', async () => {
    const created = await ctx.agentDefinitionStore.createDefinition(createAgentDefinitionInput());
    const deleted = await ctx.agentDefinitionStore.deleteDefinition(created.id);

    expect(deleted).toBe(true);
    const fetched = await ctx.agentDefinitionStore.getDefinition(created.id);
    expect(fetched).toBeNull();
  });

  it('should throw when deleting a built-in definition', async () => {
    await expect(
      ctx.agentDefinitionStore.deleteDefinition('agent-def-claude-code'),
    ).rejects.toThrow('Cannot delete built-in');
  });
});
