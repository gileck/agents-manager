import { describe, it, expect } from 'vitest';
import { ImplementorPromptBuilder } from '../../src/core/agents/implementor-prompt-builder';
import type { AgentContext, AgentConfig, Task, Project, AgentMode, RevisionReason } from '../../src/shared/types';
import type { AgentLibResult } from '../../src/core/interfaces/agent-lib';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Implement login feature',
    description: 'Add OAuth login support',
    status: 'implementing',
    priority: 1,
    tags: ['auth'],
    parentTaskId: null,
    featureId: null,
    assignee: null,
    prLink: null,
    branchName: null,
    plan: null,
    technicalDesign: null,
    subtasks: [],
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

const defaultConfig: AgentConfig = {};

describe('ImplementorPromptBuilder', () => {
  const builder = new ImplementorPromptBuilder();

  describe('type', () => {
    it('should be implementor', () => {
      expect(builder.type).toBe('implementor');
    });
  });

  describe('getMaxTurns (via buildExecutionConfig)', () => {
    it('should return 200 for new mode', () => {
      const ctx = createContext({ mode: 'new' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.maxTurns).toBe(200);
    });

    it('should return 200 for revision with changes_requested', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'changes_requested' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.maxTurns).toBe(200);
    });

    it('should return 200 for revision with info_provided', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'info_provided' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.maxTurns).toBe(200);
    });

    it('should return 50 for revision with conflicts_detected', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'conflicts_detected' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.maxTurns).toBe(50);
    });
  });

  describe('getTimeout (via buildExecutionConfig)', () => {
    it('should return 30 min for new mode', () => {
      const ctx = createContext({ mode: 'new' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.timeoutMs).toBe(30 * 60 * 1000);
    });

    it('should return 30 min for revision with changes_requested', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'changes_requested' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.timeoutMs).toBe(30 * 60 * 1000);
    });

    it('should return 10 min for revision with conflicts_detected', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'conflicts_detected' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.timeoutMs).toBe(10 * 60 * 1000);
    });

    it('should respect config.timeout override', () => {
      const ctx = createContext({ mode: 'new' });
      const config = builder.buildExecutionConfig(ctx, { timeout: 5 * 60 * 1000 });
      expect(config.timeoutMs).toBe(5 * 60 * 1000);
    });
  });

  describe('getOutputFormat (via buildExecutionConfig)', () => {
    it('should return summary schema for new mode', () => {
      const ctx = createContext({ mode: 'new' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.outputFormat).toBeDefined();
      const schema = (config.outputFormat as { schema: { required: string[] } }).schema;
      expect(schema.required).toContain('summary');
    });

    it('should return summary schema for revision with changes_requested', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'changes_requested' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.outputFormat).toBeDefined();
      const schema = (config.outputFormat as { schema: { required: string[] } }).schema;
      expect(schema.required).toContain('summary');
    });

    it('should return summary schema for revision with conflicts_detected', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'conflicts_detected' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.outputFormat).toBeDefined();
      const schema = (config.outputFormat as { schema: { required: string[] } }).schema;
      expect(schema.required).toContain('summary');
    });
  });

  describe('buildPrompt', () => {
    it('should include task title in new mode prompt', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Implement login feature');
    });

    it('should include task description in new mode prompt', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Add OAuth login support');
    });

    it('should include plan in new mode prompt', () => {
      const ctx = createContext({
        mode: 'new',
        task: createTask({ plan: 'Step 1: Create auth module\nStep 2: Add routes' }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Step 1: Create auth module');
    });

    it('should include subtask checklist in new mode prompt', () => {
      const ctx = createContext({
        mode: 'new',
        task: createTask({
          subtasks: [
            { id: 'st-1', taskId: 'task-1', name: 'Create module', status: 'done', sortOrder: 0 },
            { id: 'st-2', taskId: 'task-1', name: 'Add tests', status: 'pending', sortOrder: 1 },
          ],
        }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('[x] Create module');
      expect(prompt).toContain('[ ] Add tests');
    });

    it('should include technical design in new mode prompt', () => {
      const ctx = createContext({
        mode: 'new',
        task: createTask({ technicalDesign: 'Architecture: microservices' }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Architecture: microservices');
    });

    it('should include interactive instructions for new mode', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Interactive Questions');
    });

    it('should not include interactive instructions for changes_requested', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'changes_requested' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).not.toContain('Interactive Questions');
    });

    it('should not include interactive instructions for conflicts_detected', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'conflicts_detected' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).not.toContain('Interactive Questions');
    });

    it('should append validation errors when present', () => {
      const ctx = createContext({ mode: 'new', validationErrors: 'ESLint: unused variable' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('ESLint: unused variable');
      expect(prompt).toContain('validation errors');
    });
  });

  describe('buildPrompt — phase-aware display', () => {
    it('should show active phase and completed phases in new mode', () => {
      const ctx = createContext({
        mode: 'new',
        task: createTask({
          phases: [
            {
              id: 'phase-1',
              name: 'Phase 1: Data Model',
              status: 'completed',
              prLink: 'https://github.com/repo/pulls/1',
              subtasks: [
                { id: 'st-1', taskId: 'task-1', name: 'Create schema', status: 'done', sortOrder: 0 },
              ],
            },
            {
              id: 'phase-2',
              name: 'Phase 2: API',
              status: 'in_progress',
              subtasks: [
                { id: 'st-2', taskId: 'task-1', name: 'Add endpoints', status: 'pending', sortOrder: 0 },
              ],
            },
          ],
        }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Phase 2: API');
      expect(prompt).toContain('Phase 1: Data Model (completed');
      expect(prompt).toContain('[ ] Add endpoints');
    });
  });

  describe('inferOutcome', () => {
    it('should return failed for non-zero exit code', () => {
      expect(builder.inferOutcome('new', 1, '')).toBe('failed');
    });

    it('should return pr_ready for new mode with exit 0', () => {
      expect(builder.inferOutcome('new', 0, '')).toBe('pr_ready');
    });

    it('should return pr_ready for revision mode with exit 0', () => {
      expect(builder.inferOutcome('revision', 0, '')).toBe('pr_ready');
    });
  });

  describe('buildResult — needs_info override', () => {
    it('should override outcome to needs_info when structured output has questions', () => {
      const ctx = createContext({ mode: 'new' });
      const libResult: AgentLibResult = {
        exitCode: 0,
        output: 'Implementation output',
        structuredOutput: {
          outcome: 'needs_info',
          questions: [{ id: 'q1', question: 'Which auth provider?' }],
        },
      };
      const result = builder.buildResult(ctx, libResult, 'pr_ready', 'prompt');
      expect(result.outcome).toBe('needs_info');
      expect(result.payload).toEqual({ questions: [{ id: 'q1', question: 'Which auth provider?' }] });
    });

    it('should not override when questions array is empty', () => {
      const ctx = createContext({ mode: 'new' });
      const libResult: AgentLibResult = {
        exitCode: 0,
        output: 'Implementation output',
        structuredOutput: {
          outcome: 'needs_info',
          questions: [],
        },
      };
      const result = builder.buildResult(ctx, libResult, 'pr_ready', 'prompt');
      expect(result.outcome).toBe('pr_ready');
    });

    it('should not override on non-zero exit code', () => {
      const ctx = createContext({ mode: 'new' });
      const libResult: AgentLibResult = {
        exitCode: 1,
        output: 'Error',
        structuredOutput: {
          outcome: 'needs_info',
          questions: [{ id: 'q1', question: 'What?' }],
        },
      };
      const result = builder.buildResult(ctx, libResult, 'failed', 'prompt');
      expect(result.outcome).toBe('failed');
    });
  });

  describe('readOnly flag', () => {
    it('should set readOnly=false for new mode', () => {
      const ctx = createContext({ mode: 'new' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.readOnly).toBe(false);
    });

    it('should set readOnly=false for revision mode', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'changes_requested' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.readOnly).toBe(false);
    });
  });

  describe('all modes produce a prompt', () => {
    const modeConfigs: Array<{ mode: AgentMode; revisionReason?: RevisionReason; label: string }> = [
      { mode: 'new', label: 'new (implement)' },
      { mode: 'revision', revisionReason: 'changes_requested', label: 'revision (changes_requested)' },
      { mode: 'revision', revisionReason: 'conflicts_detected', label: 'revision (conflicts_detected)' },
      { mode: 'revision', revisionReason: 'info_provided', label: 'revision (info_provided)' },
    ];

    for (const { mode, revisionReason, label } of modeConfigs) {
      it(`should produce a non-empty prompt for ${label}`, () => {
        const ctx = createContext({ mode, revisionReason });
        const config = builder.buildExecutionConfig(ctx, defaultConfig);
        expect(config.prompt.length).toBeGreaterThan(0);
      });
    }
  });
});
