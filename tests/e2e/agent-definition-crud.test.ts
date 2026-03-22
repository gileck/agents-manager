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

    const implementor = builtIn.find(d => d.id === 'agent-def-implementor');
    expect(implementor).toBeDefined();
    expect(implementor!.name).toBe('Implementor');

    const reviewer = builtIn.find(d => d.id === 'agent-def-reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer!.name).toBe('Reviewer');
  });

  it('should get a definition by ID', async () => {
    const def = await ctx.agentDefinitionStore.getDefinition('agent-def-implementor');

    expect(def).not.toBeNull();
    expect(def!.id).toBe('agent-def-implementor');
    expect(def!.engine).toBe('claude-code');
    expect(def!.isBuiltIn).toBe(true);
    expect(Array.isArray(def!.modes)).toBe(true);
    expect(def!.modes.length).toBeGreaterThan(0);
    expect(def!.modes[0]).toHaveProperty('mode');
    expect(def!.modes[0]).toHaveProperty('promptTemplate');
  });

  it('should get a definition by agent type', async () => {
    const def = await ctx.agentDefinitionStore.getDefinitionByAgentType('implementor');

    expect(def).not.toBeNull();
    expect(def!.id).toBe('agent-def-implementor');
  });

  it('should return null for non-existent agent type', async () => {
    const def = await ctx.agentDefinitionStore.getDefinitionByAgentType('non-existent');
    expect(def).toBeNull();
  });

  it('should get a definition by mode', async () => {
    const def = await ctx.agentDefinitionStore.getDefinitionByMode('new');

    expect(def).not.toBeNull();
    // Multiple definitions have 'new' mode; just verify one was found
    expect(def!.id).toBeDefined();
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
    const newModes = [{ mode: 'new', promptTemplate: 'Implement: {taskTitle}' }];

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
      ctx.agentDefinitionStore.deleteDefinition('agent-def-implementor'),
    ).rejects.toThrow('Cannot delete built-in');
  });

  it('should update model override on a built-in definition', async () => {
    // Verify the seeded definition starts with model: null
    const before = await ctx.agentDefinitionStore.getDefinition('agent-def-investigator');
    expect(before).not.toBeNull();
    expect(before!.isBuiltIn).toBe(true);
    expect(before!.model).toBeNull();

    // Update the model override (mimics the Edit Agent UI save path)
    const updated = await ctx.agentDefinitionStore.updateDefinition('agent-def-investigator', {
      model: 'claude-sonnet-4-5-20250929',
    });

    expect(updated).not.toBeNull();
    expect(updated!.model).toBe('claude-sonnet-4-5-20250929');
    expect(updated!.id).toBe('agent-def-investigator');
    expect(updated!.isBuiltIn).toBe(true);

    // Verify the convention-based lookup returns the updated model
    const byType = await ctx.agentDefinitionStore.getDefinitionByAgentType('investigator');
    expect(byType).not.toBeNull();
    expect(byType!.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('should return updated model via getDefinition after built-in update', async () => {
    await ctx.agentDefinitionStore.updateDefinition('agent-def-implementor', {
      model: 'test-model-override',
    });

    // Direct ID lookup (same path as agent-service.ts:615)
    const def = await ctx.agentDefinitionStore.getDefinition('agent-def-implementor');
    expect(def).not.toBeNull();
    expect(def!.model).toBe('test-model-override');
  });
});
