import { describe, it, expect } from 'vitest';
import { ImplementorPromptBuilder } from '../../src/main/agents/implementor-prompt-builder';
import type { AgentContext, AgentConfig, Task, Project, AgentMode } from '../../src/shared/types';
import type { AgentLibResult } from '../../src/main/interfaces/agent-lib';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Implement login feature',
    description: 'Add OAuth login support',
    status: 'planning',
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
    mode: 'plan',
    ...overrides,
  } as AgentContext;
}

const defaultConfig: AgentConfig = {};

describe('ImplementorPromptBuilder', () => {
  const builder = new ImplementorPromptBuilder();

  describe('type', () => {
    it('should be claude-code', () => {
      expect(builder.type).toBe('claude-code');
    });
  });

  describe('getMaxTurns (via buildExecutionConfig)', () => {
    const planModes: AgentMode[] = ['plan', 'plan_revision', 'plan_resume', 'investigate', 'investigate_resume', 'technical_design', 'technical_design_revision', 'technical_design_resume'];
    const implementModes: AgentMode[] = ['implement', 'implement_resume', 'request_changes'];

    for (const mode of planModes) {
      it(`should return 150 for ${mode}`, () => {
        const ctx = createContext({ mode });
        const config = builder.buildExecutionConfig(ctx, defaultConfig);
        expect(config.maxTurns).toBe(150);
      });
    }

    for (const mode of implementModes) {
      it(`should return 200 for ${mode}`, () => {
        const ctx = createContext({ mode });
        const config = builder.buildExecutionConfig(ctx, defaultConfig);
        expect(config.maxTurns).toBe(200);
      });
    }

    it('should return 50 for resolve_conflicts', () => {
      const ctx = createContext({ mode: 'resolve_conflicts' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.maxTurns).toBe(50);
    });

    it('should throw for unknown modes', () => {
      const ctx = createContext({ mode: 'review' as AgentMode });
      expect(() => builder.buildExecutionConfig(ctx, defaultConfig)).toThrow(
        /No prompt definition registered for mode "review"/
      );
    });
  });

  describe('getTimeout (via buildExecutionConfig)', () => {
    it('should return 30 min for implement mode', () => {
      const ctx = createContext({ mode: 'implement' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.timeoutMs).toBe(30 * 60 * 1000);
    });

    it('should return 30 min for request_changes mode', () => {
      const ctx = createContext({ mode: 'request_changes' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.timeoutMs).toBe(30 * 60 * 1000);
    });

    it('should return 10 min for plan mode', () => {
      const ctx = createContext({ mode: 'plan' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.timeoutMs).toBe(10 * 60 * 1000);
    });

    it('should respect config.timeout override', () => {
      const ctx = createContext({ mode: 'implement' });
      const config = builder.buildExecutionConfig(ctx, { timeout: 5 * 60 * 1000 });
      expect(config.timeoutMs).toBe(5 * 60 * 1000);
    });
  });

  describe('getOutputFormat (via buildExecutionConfig)', () => {
    it('should return plan schema for plan mode', () => {
      const ctx = createContext({ mode: 'plan' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.outputFormat).toBeDefined();
      const schema = (config.outputFormat as { schema: { required: string[] } }).schema;
      expect(schema.required).toContain('plan');
      expect(schema.required).toContain('planSummary');
      expect(schema.required).toContain('subtasks');
    });

    it('should return investigation schema for investigate mode', () => {
      const ctx = createContext({ mode: 'investigate' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.outputFormat).toBeDefined();
      const schema = (config.outputFormat as { schema: { required: string[] } }).schema;
      expect(schema.required).toContain('investigationSummary');
    });

    it('should return technical design schema for technical_design mode', () => {
      const ctx = createContext({ mode: 'technical_design' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.outputFormat).toBeDefined();
      const schema = (config.outputFormat as { schema: { required: string[] } }).schema;
      expect(schema.required).toContain('technicalDesign');
      expect(schema.required).toContain('designSummary');
    });

    it('should return summary schema for implement mode', () => {
      const ctx = createContext({ mode: 'implement' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.outputFormat).toBeDefined();
      const schema = (config.outputFormat as { schema: { required: string[] } }).schema;
      expect(schema.required).toContain('summary');
    });

    it('should throw for unknown modes', () => {
      const ctx = createContext({ mode: 'review' as AgentMode });
      expect(() => builder.buildExecutionConfig(ctx, defaultConfig)).toThrow(
        /No prompt definition registered for mode "review"/
      );
    });
  });

  describe('buildPrompt', () => {
    it('should include task title in plan prompt', () => {
      const ctx = createContext({ mode: 'plan' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Implement login feature');
    });

    it('should include task description in plan prompt', () => {
      const ctx = createContext({ mode: 'plan' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Add OAuth login support');
    });

    it('should include plan in implement prompt', () => {
      const ctx = createContext({
        mode: 'implement',
        task: createTask({ plan: 'Step 1: Create auth module\nStep 2: Add routes' }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Step 1: Create auth module');
    });

    it('should include subtask checklist in implement prompt', () => {
      const ctx = createContext({
        mode: 'implement',
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

    it('should include admin feedback in plan_revision prompt', () => {
      const ctx = createContext({
        mode: 'plan_revision',
        task: createTask({
          plan: 'Original plan',
          planComments: [{ author: 'admin', content: 'Add more detail', createdAt: 1700000000000 }],
        }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Add more detail');
      expect(prompt).toContain('admin');
    });

    it('should include related task info in investigate prompt', () => {
      const ctx = createContext({
        mode: 'investigate',
        task: createTask({ metadata: { relatedTaskId: 'task-99' } }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('task-99');
    });

    it('should include technical design in implement prompt', () => {
      const ctx = createContext({
        mode: 'implement',
        task: createTask({ technicalDesign: 'Architecture: microservices' }),
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Architecture: microservices');
    });

    it('should include interactive instructions for plan mode', () => {
      const ctx = createContext({ mode: 'plan' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Interactive Questions');
    });

    it('should not include interactive instructions for resolve_conflicts', () => {
      const ctx = createContext({ mode: 'resolve_conflicts' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).not.toContain('Interactive Questions');
    });

    it('should append validation errors when present', () => {
      const ctx = createContext({ mode: 'implement', validationErrors: 'ESLint: unused variable' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('ESLint: unused variable');
      expect(prompt).toContain('validation errors');
    });
  });

  describe('buildPrompt — phase-aware display', () => {
    it('should show active phase and completed phases in implement mode', () => {
      const ctx = createContext({
        mode: 'implement',
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
      expect(builder.inferOutcome('plan', 1, '')).toBe('failed');
    });

    it('should return plan_complete for plan mode with exit 0', () => {
      expect(builder.inferOutcome('plan', 0, '')).toBe('plan_complete');
    });

    it('should return plan_complete for plan_revision', () => {
      expect(builder.inferOutcome('plan_revision', 0, '')).toBe('plan_complete');
    });

    it('should return investigation_complete for investigate', () => {
      expect(builder.inferOutcome('investigate', 0, '')).toBe('investigation_complete');
    });

    it('should return design_ready for technical_design', () => {
      expect(builder.inferOutcome('technical_design', 0, '')).toBe('design_ready');
    });

    it('should return pr_ready for implement', () => {
      expect(builder.inferOutcome('implement', 0, '')).toBe('pr_ready');
    });

    it('should return pr_ready for request_changes', () => {
      expect(builder.inferOutcome('request_changes', 0, '')).toBe('pr_ready');
    });

    it('should return pr_ready for resolve_conflicts', () => {
      expect(builder.inferOutcome('resolve_conflicts', 0, '')).toBe('pr_ready');
    });

    it('should throw for unknown mode', () => {
      expect(() => builder.inferOutcome('unknown_mode', 0, '')).toThrow(
        /No prompt definition registered for mode "unknown_mode"/
      );
    });
  });

  describe('buildResult — needs_info override', () => {
    it('should override outcome to needs_info when structured output has questions', () => {
      const ctx = createContext({ mode: 'plan' });
      const libResult: AgentLibResult = {
        exitCode: 0,
        output: 'Plan output',
        structuredOutput: {
          outcome: 'needs_info',
          questions: [{ id: 'q1', question: 'Which auth provider?' }],
        },
      };
      const result = builder.buildResult(ctx, libResult, 'plan_complete', 'prompt');
      expect(result.outcome).toBe('needs_info');
      expect(result.payload).toEqual({ questions: [{ id: 'q1', question: 'Which auth provider?' }] });
    });

    it('should not override when questions array is empty', () => {
      const ctx = createContext({ mode: 'plan' });
      const libResult: AgentLibResult = {
        exitCode: 0,
        output: 'Plan output',
        structuredOutput: {
          outcome: 'needs_info',
          questions: [],
        },
      };
      const result = builder.buildResult(ctx, libResult, 'plan_complete', 'prompt');
      expect(result.outcome).toBe('plan_complete');
    });

    it('should not override on non-zero exit code', () => {
      const ctx = createContext({ mode: 'plan' });
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
    const readOnlyModes: AgentMode[] = ['plan', 'plan_revision', 'plan_resume', 'investigate', 'investigate_resume'];
    const writeModes: AgentMode[] = ['implement', 'implement_resume', 'request_changes', 'resolve_conflicts'];

    for (const mode of readOnlyModes) {
      it(`should set readOnly=true for ${mode}`, () => {
        const ctx = createContext({ mode });
        const config = builder.buildExecutionConfig(ctx, defaultConfig);
        expect(config.readOnly).toBe(true);
      });
    }

    for (const mode of writeModes) {
      it(`should set readOnly=false for ${mode}`, () => {
        const ctx = createContext({ mode });
        const config = builder.buildExecutionConfig(ctx, defaultConfig);
        expect(config.readOnly).toBe(false);
      });
    }
  });

  describe('all 12 registered modes produce a prompt', () => {
    const allModes: AgentMode[] = [
      'plan', 'plan_revision', 'plan_resume',
      'implement', 'implement_resume',
      'request_changes', 'resolve_conflicts',
      'investigate', 'investigate_resume',
      'technical_design', 'technical_design_revision', 'technical_design_resume',
    ];

    for (const mode of allModes) {
      it(`should produce a non-empty prompt for ${mode}`, () => {
        const ctx = createContext({ mode });
        const config = builder.buildExecutionConfig(ctx, defaultConfig);
        expect(config.prompt.length).toBeGreaterThan(0);
      });
    }
  });
});
