import { describe, it, expect } from 'vitest';
import type { AgentContext, AgentConfig, AgentFileConfig, Task, Project } from '../../src/shared/types';
import { PlannerPromptBuilder } from '../../src/core/agents/planner-prompt-builder';
import { ReviewerPromptBuilder } from '../../src/core/agents/reviewer-prompt-builder';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Test task',
    description: 'Test description',
    type: 'feature',
    size: null,
    complexity: null,
    status: 'planning',
    priority: 1,
    tags: [],
    parentTaskId: null,
    featureId: null,
    assignee: null,
    prLink: null,
    branchName: null,
    plan: null,
    investigationReport: null,
    technicalDesign: null,
    postMortem: null,
    debugInfo: null,
    subtasks: [],
    phases: null,
    planComments: [],
    technicalDesignComments: [],
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: null,
    ...overrides,
  };
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'TestProject',
    description: null,
    path: '/test/project',
    config: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    task: createTask(),
    project: createProject(),
    workdir: '/test/project',
    mode: 'new',
    ...overrides,
  };
}

describe('buildExecutionConfig with file config', () => {
  const config: AgentConfig = {};

  it('uses file-based prompt when provided', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();
    const fileConfig: AgentFileConfig = {
      prompt: 'You are a custom planner. Task: {taskTitle}',
      promptPath: '/test/.agents/planner/prompt.md',
    };

    const logs: string[] = [];
    const log = (msg: string) => { logs.push(msg); };

    const result = builder.buildExecutionConfig(context, config, fileConfig, log);

    expect(result.prompt).toContain('You are a custom planner. Task: Test task');
    expect(logs.some(l => l.includes('file-based prompt'))).toBe(true);
  });

  it('falls back to hardcoded prompt when no file config', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();

    const result = builder.buildExecutionConfig(context, config);

    // Should contain content from the hardcoded PlannerPromptBuilder
    expect(result.prompt.length).toBeGreaterThan(100);
  });

  it('falls back to hardcoded prompt when file config has no prompt', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();
    const fileConfig: AgentFileConfig = {
      config: { maxTurns: 50 },
      configPath: '/test/.agents/planner/config.json',
    };

    const result = builder.buildExecutionConfig(context, config, fileConfig);

    // Prompt from hardcoded builder, but maxTurns from file
    expect(result.prompt.length).toBeGreaterThan(100);
    expect(result.maxTurns).toBe(50);
  });

  it('overrides maxTurns from file config', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();
    const fileConfig: AgentFileConfig = {
      config: { maxTurns: 42 },
      configPath: '/test/.agents/planner/config.json',
    };

    const result = builder.buildExecutionConfig(context, config, fileConfig);

    expect(result.maxTurns).toBe(42);
  });

  it('overrides timeout from file config', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();
    const fileConfig: AgentFileConfig = {
      config: { timeout: 120000 },
      configPath: '/test/.agents/planner/config.json',
    };

    const result = builder.buildExecutionConfig(context, config, fileConfig);

    expect(result.timeoutMs).toBe(120000);
  });

  it('overrides readOnly from file config', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();
    const fileConfig: AgentFileConfig = {
      config: { readOnly: true },
      configPath: '/test/.agents/planner/config.json',
    };

    const result = builder.buildExecutionConfig(context, config, fileConfig);

    expect(result.readOnly).toBe(true);
  });

  it('overrides disallowedTools from file config', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();
    const fileConfig: AgentFileConfig = {
      config: { disallowedTools: ['Write', 'Bash'] },
      configPath: '/test/.agents/planner/config.json',
    };

    const result = builder.buildExecutionConfig(context, config, fileConfig);

    expect(result.disallowedTools).toEqual(['Write', 'Bash']);
  });

  it('overrides outputFormat from file config', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();
    const customFormat = { type: 'json_schema', schema: { type: 'object' } };
    const fileConfig: AgentFileConfig = {
      config: { outputFormat: customFormat },
      configPath: '/test/.agents/planner/config.json',
    };

    const result = builder.buildExecutionConfig(context, config, fileConfig);

    expect(result.outputFormat).toEqual(customFormat);
  });

  it('uses builder defaults when file config fields are absent', () => {
    const builder = new ReviewerPromptBuilder();
    const context = createContext();
    const fileConfig: AgentFileConfig = {};

    const defaultResult = builder.buildExecutionConfig(context, config);
    const fileResult = builder.buildExecutionConfig(context, config, fileConfig);

    expect(fileResult.maxTurns).toBe(defaultResult.maxTurns);
    expect(fileResult.timeoutMs).toBe(defaultResult.timeoutMs);
    expect(fileResult.readOnly).toBe(defaultResult.readOnly);
  });

  it('applies PromptRenderer variable substitution on file-based prompt', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext({
      task: createTask({ title: 'My Custom Task', description: 'Important work' }),
    });
    const fileConfig: AgentFileConfig = {
      prompt: '# Plan for: {taskTitle}\n\nDescription:{taskDescription}\nTask ID: {taskId}',
      promptPath: '/test/.agents/planner/prompt.md',
    };

    const result = builder.buildExecutionConfig(context, config, fileConfig);

    expect(result.prompt).toContain('# Plan for: My Custom Task');
    expect(result.prompt).toContain('Description: Important work');
    expect(result.prompt).toContain('Task ID: task-1');
  });

  it('appends skills section to file-based prompt', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext({ skills: ['review-pr', 'commit'] });
    const fileConfig: AgentFileConfig = {
      prompt: 'Custom prompt',
      promptPath: '/test/.agents/planner/prompt.md',
    };

    const result = builder.buildExecutionConfig(context, config, fileConfig);

    expect(result.prompt).toContain('Available Skills');
    expect(result.prompt).toContain('/review-pr');
    expect(result.prompt).toContain('/commit');
  });

  it('logs config merge with source attribution', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();
    const fileConfig: AgentFileConfig = {
      config: { maxTurns: 50, timeout: 120000 },
      configPath: '/test/.agents/planner/config.json',
    };

    const logs: string[] = [];
    const log = (msg: string) => { logs.push(msg); };

    builder.buildExecutionConfig(context, config, fileConfig, log);

    const configLog = logs.find(l => l.includes('config:'));
    expect(configLog).toBeDefined();
    expect(configLog).toContain('maxTurns=50 (file)');
    expect(configLog).toContain('timeout=120000 (file)');
    expect(configLog).toContain('readOnly=');
  });

  it('backward compatible — identical behavior with undefined fileConfig', () => {
    const builder = new PlannerPromptBuilder();
    const context = createContext();

    const withoutFileConfig = builder.buildExecutionConfig(context, config);
    const withUndefined = builder.buildExecutionConfig(context, config, undefined);

    expect(withoutFileConfig.maxTurns).toBe(withUndefined.maxTurns);
    expect(withoutFileConfig.timeoutMs).toBe(withUndefined.timeoutMs);
    expect(withoutFileConfig.readOnly).toBe(withUndefined.readOnly);
    expect(withoutFileConfig.prompt).toBe(withUndefined.prompt);
  });
});
