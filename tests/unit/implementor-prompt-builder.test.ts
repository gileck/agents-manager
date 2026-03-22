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
    debugInfo: null,
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

    it('should return 100 for revision with merge_failed', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'merge_failed' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.maxTurns).toBe(100);
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

    it('should return 15 min for revision with merge_failed', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'merge_failed' });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.timeoutMs).toBe(15 * 60 * 1000);
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

    it('should return summary schema for revision with merge_failed', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'merge_failed' });
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
        docs: [
          { id: 'doc-1', taskId: 'task-1', type: 'plan', content: 'Step 1: Create auth module\nStep 2: Add routes', summary: null, version: 1, createdAt: 1700000000000, updatedAt: 1700000000000 },
        ],
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

    it('should include CLAUDE.md instruction in new mode prompt', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Read CLAUDE.md');
      expect(prompt).toContain('project rules');
    });

    it('should include architecture docs instruction in new mode prompt', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('architecture documentation');
      expect(prompt).toContain('docs/architecture-overview.md');
      expect(prompt).toContain('docs/abstractions.md');
    });

    it('should include security awareness instruction in new mode prompt', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('no hardcoded secrets');
      expect(prompt).toContain('OWASP top 10');
    });

    it('should include test coverage instruction in new mode prompt', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Add or update tests for new code paths');
    });

    it('should include error handling instruction in new mode prompt', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Surface errors properly');
      expect(prompt).toContain('empty catch blocks');
    });

    it('should include architecture compliance instruction in new mode prompt', () => {
      const ctx = createContext({ mode: 'new' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Respect architecture boundaries');
      expect(prompt).toContain('src/core/services/');
      expect(prompt).toContain('src/core/interfaces/');
    });

    it('should not include new review-aligned instructions in revision prompts', () => {
      const revisionModes: Array<{ revisionReason: RevisionReason }> = [
        { revisionReason: 'changes_requested' },
        { revisionReason: 'merge_failed' },
        { revisionReason: 'uncommitted_changes' },
      ];
      for (const { revisionReason } of revisionModes) {
        const ctx = createContext({ mode: 'revision', revisionReason });
        const prompt = builder.buildPrompt(ctx);
        expect(prompt).not.toContain('Read CLAUDE.md');
        expect(prompt).not.toContain('docs/architecture-overview.md');
        expect(prompt).not.toContain('OWASP top 10');
        expect(prompt).not.toContain('Respect architecture boundaries');
      }
    });

    it('should include technical design in new mode prompt', () => {
      const ctx = createContext({
        mode: 'new',
        docs: [
          { id: 'doc-2', taskId: 'task-1', type: 'technical_design', content: 'Architecture: microservices', summary: 'Architecture: microservices', version: 1, createdAt: 1700000000000, updatedAt: 1700000000000 },
        ],
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

    it('should not include interactive instructions for merge_failed', () => {
      const ctx = createContext({ mode: 'revision', revisionReason: 'merge_failed' });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).not.toContain('Interactive Questions');
    });

    it('should include merge failure details from task context in merge_failed prompt', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'merge_failed' as RevisionReason,
        taskContext: [
          {
            id: 'ctx-mf-1',
            taskId: 'task-1',
            agentRunId: null,
            source: 'system',
            entryType: 'merge_failure',
            summary: 'PR merge failed: PR is not mergeable (likely has conflicts with base branch)',
            data: {
              errorMessage: 'PR is not mergeable',
              prUrl: 'https://github.com/org/repo/pull/42',
              mergeable: 'CONFLICTING',
              mergeStateStatus: 'DIRTY',
              failingChecks: [
                { name: 'ci/build', status: 'FAILURE', url: 'https://ci.example.com/build/123' },
              ],
              timestamp: 1700000000000,
            },
            createdAt: 1700000000000,
            addressed: false,
            addressedByRunId: null,
          },
        ],
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('Merge Failure Details');
      expect(prompt).toContain('PR is not mergeable');
      expect(prompt).toContain('https://github.com/org/repo/pull/42');
      expect(prompt).toContain('CONFLICTING');
      expect(prompt).toContain('DIRTY');
      expect(prompt).toContain('ci/build');
      expect(prompt).toContain('FAILURE');
      expect(prompt).toContain('https://ci.example.com/build/123');
    });

    it('should produce valid merge_failed prompt without task context entries', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'merge_failed' as RevisionReason,
        taskContext: [],
      });
      const prompt = builder.buildPrompt(ctx);
      expect(prompt).toContain('merge conflicts');
      expect(prompt).toContain('git fetch origin');
      expect(prompt).toContain('git rebase origin/main');
      expect(prompt).not.toContain('Merge Failure Details');
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

  describe('review_feedback comments included in prompt', () => {
    it('should include reviewer comments from data.comments in the generated prompt', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'changes_requested' as RevisionReason,
        taskContext: [
          {
            id: 'ctx-1',
            taskId: 'task-1',
            agentRunId: 'run-1',
            source: 'reviewer',
            entryType: 'review_feedback',
            summary: 'Found issues with error handling',
            data: {
              verdict: 'changes_requested',
              comments: [
                'Fix the null check in getUserById — it silently returns undefined instead of throwing',
                'Add input validation for the email parameter in createUser',
              ],
            },
            createdAt: 1700000000000,
            addressed: false,
            addressedByRunId: null,
          },
        ],
      });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.prompt).toContain('Fix the null check in getUserById');
      expect(config.prompt).toContain('Add input validation for the email parameter in createUser');
    });

    it('should still render summary when data.comments is absent', () => {
      const ctx = createContext({
        mode: 'revision' as AgentMode,
        revisionReason: 'changes_requested' as RevisionReason,
        taskContext: [
          {
            id: 'ctx-1',
            taskId: 'task-1',
            agentRunId: 'run-1',
            source: 'reviewer',
            entryType: 'review_feedback',
            summary: 'Found issues with error handling',
            data: { verdict: 'changes_requested' },
            createdAt: 1700000000000,
            addressed: false,
            addressedByRunId: null,
          },
        ],
      });
      const config = builder.buildExecutionConfig(ctx, defaultConfig);
      expect(config.prompt).toContain('Found issues with error handling');
      expect(config.prompt).not.toContain('Review Comments');
    });
  });

  describe('all modes produce a prompt', () => {
    const modeConfigs: Array<{ mode: AgentMode; revisionReason?: RevisionReason; label: string }> = [
      { mode: 'new', label: 'new (implement)' },
      { mode: 'revision', revisionReason: 'changes_requested', label: 'revision (changes_requested)' },
      { mode: 'revision', revisionReason: 'merge_failed', label: 'revision (merge_failed)' },
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
