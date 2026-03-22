import { describe, it, expect } from 'vitest';
import { InvestigatorPromptBuilder } from '../../src/core/agents/investigator-prompt-builder';
import type { AgentContext, Task, Project, AgentMode, RevisionReason } from '../../src/shared/types';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: '[Bug] Widget fails to render',
    description: 'The widget crashes on load',
    status: 'investigating',
    priority: 0,
    tags: ['bug'],
    parentTaskId: null,
    featureId: null,
    assignee: null,
    prLink: null,
    branchName: null,
    plan: null,
    technicalDesign: null,
    debugInfo: null,
    subtasks: [],
    phases: null,
    planComments: [],
    technicalDesignComments: [],
    metadata: {},
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'TestProject',
    description: 'A test project',
    path: '/home/user/project',
    config: {},
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

function createContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    task: createTask(),
    project: createProject(),
    workdir: '/home/user/project',
    mode: 'new' as AgentMode,
    ...overrides,
  } as AgentContext;
}

describe('InvestigatorPromptBuilder', () => {
  const builder = new InvestigatorPromptBuilder();

  describe('debugInfo in new investigation mode', () => {
    it('should include debugInfo section when debugInfo is present', () => {
      const ctx = createContext({
        mode: 'new',
        task: createTask({ debugInfo: 'Timeline: agent started at 10:00\nError: ENOENT at 10:05' }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('## Debug Info');
      expect(prompt).toContain('Timeline: agent started at 10:00');
      expect(prompt).toContain('Error: ENOENT at 10:05');
    });

    it('should not include debugInfo section when debugInfo is null', () => {
      const ctx = createContext({
        mode: 'new',
        task: createTask({ debugInfo: null }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).not.toContain('## Debug Info');
    });

    it('should not include debugInfo section when debugInfo is empty string', () => {
      const ctx = createContext({
        mode: 'new',
        task: createTask({ debugInfo: '' }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).not.toContain('## Debug Info');
    });
  });

  describe('debugInfo in revision (info_provided) mode', () => {
    it('should include debugInfo section when debugInfo is present', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'info_provided' as RevisionReason,
        task: createTask({ debugInfo: 'SDK heartbeat at 10:00\nWorktree lock at 10:01' }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('## Debug Info');
      expect(prompt).toContain('SDK heartbeat at 10:00');
      expect(prompt).toContain('Worktree lock at 10:01');
    });

    it('should not include debugInfo section when debugInfo is null', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'info_provided' as RevisionReason,
        task: createTask({ debugInfo: null }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).not.toContain('## Debug Info');
    });
  });

  describe('report structure includes architectural analysis and fix options', () => {
    it('should include Architectural Analysis section in new investigation', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('## Architectural Analysis');
    });

    it('should include Fix Options with three options in new investigation', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('## Fix Options');
      expect(prompt).toContain('### Option 1: Direct Fix');
      expect(prompt).toContain('### Option 2: Architectural Fix');
      expect(prompt).toContain('### Option 3: Balanced Approach');
    });

    it('should not include old Suggested Fix field in new investigation', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).not.toContain('**Suggested Fix:**');
    });

    it('should include Architectural Analysis section in revision mode', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'info_provided' as RevisionReason,
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('## Architectural Analysis');
    });

    it('should include Fix Options with three options in revision mode', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'info_provided' as RevisionReason,
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('## Fix Options');
      expect(prompt).toContain('### Option 1: Direct Fix');
      expect(prompt).toContain('### Option 2: Architectural Fix');
      expect(prompt).toContain('### Option 3: Balanced Approach');
    });
  });

  describe('instructions include architectural analysis step', () => {
    it('should instruct agent to analyze architectural context in new investigation', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Analyze the architectural context of the bug');
    });

    it('should instruct agent to present multiple fix options in new investigation', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Present multiple fix options at different depths');
    });

    it('should instruct agent to analyze architectural context in revision mode', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'info_provided' as RevisionReason,
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Analyze the architectural context of the bug');
    });

    it('should instruct agent to present multiple fix options in revision mode', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'info_provided' as RevisionReason,
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Present multiple fix options at different depths');
    });
  });
});
