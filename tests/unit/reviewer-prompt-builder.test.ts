import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewerPromptBuilder } from '../../src/core/agents/reviewer-prompt-builder';
import { ClaudeCodeLib } from '../../src/core/libs/claude-code-lib';
import { Agent } from '../../src/core/agents/agent';
import { AgentLibRegistry } from '../../src/core/services/agent-lib-registry';
import type { AgentContext } from '../../src/shared/types';

function createContext(taskId: string = 'test-task'): AgentContext {
  return {
    task: { id: taskId, title: 'Test task', projectId: 'proj-1', pipelineId: 'pipe-1', status: 'reviewing', priority: 0, tags: [], metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
    mode: 'new',
    workdir: '/tmp/test',
    project: { id: 'proj-1', name: 'Test Project', path: '/tmp/test' },
  } as AgentContext;
}

interface SdkStreamMessage { type: string; subtype?: string; message?: { content: { type: string; text?: string; name?: string; input?: unknown }[] }; result?: string; errors?: string[]; structured_output?: Record<string, unknown>; usage?: { input_tokens: number; output_tokens: number }; summary?: string }

async function* mockQueryGenerator(messages: SdkStreamMessage[]) {
  for (const msg of messages) {
    yield msg;
  }
}

describe('ReviewerPromptBuilder', () => {
  let promptBuilder: ReviewerPromptBuilder;

  beforeEach(() => {
    promptBuilder = new ReviewerPromptBuilder();
  });

  describe('getOutputFormat', () => {
    it('returns correct schema shape with enum-restricted verdict and structured comments', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const format = (promptBuilder as any).getOutputFormat(createContext()) as { type: string; schema: Record<string, unknown> } | undefined;
      expect(format).toBeDefined();
      expect(format.type).toBe('json_schema');
      expect(format.schema.type).toBe('object');
      expect(format.schema.required).toEqual(['verdict', 'summary', 'comments']);
      expect(format.schema.properties.verdict.enum).toEqual(['approved', 'changes_requested']);
      expect(format.schema.properties.comments.type).toBe('array');
      // Verify structured comment schema
      const commentItems = format.schema.properties.comments.items;
      expect(commentItems.type).toBe('object');
      expect(commentItems.required).toEqual(['file', 'severity', 'issue', 'suggestion']);
      expect(commentItems.properties.severity.enum).toEqual(['must_fix', 'should_fix', 'nit']);
    });
  });

  describe('buildPrompt', () => {
    it('contains tiered review criteria and no REVIEW_VERDICT text', () => {
      const prompt = promptBuilder.buildPrompt(createContext());
      expect(prompt).toContain('Must-check');
      expect(prompt).toContain('Should-check');
      expect(prompt).toContain('Nice-to-have');
      expect(prompt).toContain('Approval Threshold');
      expect(prompt).not.toContain('REVIEW_VERDICT');
    });

    it('includes architecture compliance and CLAUDE.md compliance criteria', () => {
      const prompt = promptBuilder.buildPrompt(createContext());
      expect(prompt).toContain('CLAUDE.md compliance');
      expect(prompt).toContain('Architecture compliance');
      expect(prompt).toContain('Layer boundaries');
      expect(prompt).toContain('docs/abstractions.md');
    });

    it('includes architecture docs step in non-resume mode', () => {
      const prompt = promptBuilder.buildPrompt(createContext());
      expect(prompt).toContain('architecture documentation in docs/');
      expect(prompt).toContain('docs/architecture-overview.md');
    });

    it('includes code exploration step', () => {
      const prompt = promptBuilder.buildPrompt(createContext());
      expect(prompt).toContain('read the full file to understand surrounding context');
      expect(prompt).toContain('imports, call sites, type contracts');
    });

    it('includes context consistency should-check', () => {
      const prompt = promptBuilder.buildPrompt(createContext());
      expect(prompt).toContain('Context consistency');
    });

    it('includes enriched summary description in output fields', () => {
      const prompt = promptBuilder.buildPrompt(createContext());
      expect(prompt).toContain('how many files changed, how many issues found, how many blocking');
    });

    it('includes structured comment fields in output description', () => {
      const prompt = promptBuilder.buildPrompt(createContext());
      expect(prompt).toContain('`file`');
      expect(prompt).toContain('`severity`');
      expect(prompt).toContain('`issue`');
      expect(prompt).toContain('`suggestion`');
    });

    it('includes re-review notice when prior review exists', () => {
      const ctx = createContext();
      ctx.taskContext = [
        { source: 'agent', entryType: 'review_feedback', summary: 'needs changes', createdAt: Date.now() },
      ];
      const prompt = promptBuilder.buildPrompt(ctx);
      expect(prompt).toContain('RE-REVIEW');
      expect(prompt).toContain('Verify ALL previously requested changes');
    });

    it('does not include re-review notice without prior review', () => {
      const prompt = promptBuilder.buildPrompt(createContext());
      expect(prompt).not.toContain('RE-REVIEW');
    });

    it('uses project defaultBranch', () => {
      const ctx = createContext();
      ctx.project = { id: 'proj-1', name: 'Test', path: '/tmp', description: null, createdAt: Date.now(), updatedAt: Date.now(), config: { defaultBranch: 'develop' } };
      const prompt = promptBuilder.buildPrompt(ctx);
      expect(prompt).toContain('git diff origin/develop..HEAD');
    });

    it('defaults to main when no defaultBranch configured', () => {
      const prompt = promptBuilder.buildPrompt(createContext());
      expect(prompt).toContain('git diff origin/main..HEAD');
    });

    it('includes subtask list for single-phase reviews', () => {
      const ctx = createContext();
      ctx.task.subtasks = [
        { name: 'Implement API endpoint', status: 'pending' },
        { name: 'Add unit tests', status: 'pending' },
      ];
      const prompt = promptBuilder.buildPrompt(ctx);
      expect(prompt).toContain('Task Subtasks - ALL must be implemented:');
      expect(prompt).toContain('- Implement API endpoint');
      expect(prompt).toContain('- Add unit tests');
    });

    it('adds subtask verification to review criteria when subtasks exist', () => {
      const ctx = createContext();
      ctx.task.subtasks = [{ name: 'Test subtask', status: 'pending' }];
      const prompt = promptBuilder.buildPrompt(ctx);
      expect(prompt).toContain('Subtask Completeness — verify EACH subtask listed above has been implemented');
      expect(prompt).toContain('If any subtask is missing, you MUST request changes');
    });

    it('includes subtask verification in approval threshold', () => {
      const ctx = createContext();
      ctx.task.subtasks = [{ name: 'Test subtask', status: 'pending' }];
      const prompt = promptBuilder.buildPrompt(ctx);
      expect(prompt).toContain('ALL subtasks listed above have been implemented');
      expect(prompt).toContain('If ANY subtask is missing from the implementation, you MUST request changes');
    });

    it('does not add subtask sections when no subtasks exist', () => {
      const ctx = createContext();
      ctx.task.subtasks = [];
      const prompt = promptBuilder.buildPrompt(ctx);
      expect(prompt).not.toContain('Task Subtasks');
      expect(prompt).not.toContain('Subtask Completeness');
      expect(prompt).toContain('Correctness — does the code do what the task requires?');
    });

    it('uses simplified prompt when resumeSession is true', () => {
      const ctx = createContext();
      ctx.resumeSession = true;
      const prompt = promptBuilder.buildPrompt(ctx);
      expect(prompt).toContain('review the changes you just saw being implemented');
      expect(prompt).toContain('git diff origin/main..HEAD');
      // Should NOT include verbose task intro or CLAUDE.md step
      expect(prompt).not.toContain('You are a code reviewer. Review the changes');
      expect(prompt).not.toContain('Read CLAUDE.md');
    });

    it('uses re-review preamble when resumeSession is true and prior review exists', () => {
      const ctx = createContext();
      ctx.resumeSession = true;
      ctx.taskContext = [
        { source: 'agent', entryType: 'review_feedback', summary: 'needs changes', createdAt: Date.now() },
      ] as AgentContext['taskContext'];
      const prompt = promptBuilder.buildPrompt(ctx);
      expect(prompt).toContain('re-review the changes');
      expect(prompt).toContain('Verify ALL previously requested changes were addressed');
      expect(prompt).not.toContain('You are a code reviewer. Review the changes');
    });

    it('preserves subtask review criteria when resumeSession is true', () => {
      const ctx = createContext();
      ctx.resumeSession = true;
      ctx.task.subtasks = [
        { name: 'Implement API endpoint', status: 'pending' },
        { name: 'Add unit tests', status: 'pending' },
      ];
      const prompt = promptBuilder.buildPrompt(ctx);
      // Should have simplified preamble
      expect(prompt).toContain('review the changes you just saw being implemented');
      expect(prompt).not.toContain('You are a code reviewer. Review the changes');
      // But should still include subtask list and completeness criteria
      expect(prompt).toContain('Task Subtasks - ALL must be implemented:');
      expect(prompt).toContain('- Implement API endpoint');
      expect(prompt).toContain('Subtask Completeness');
      expect(prompt).toContain('ALL subtasks listed above have been implemented');
    });

    it('falls back to full prompt when resumeSession is false', () => {
      const ctx = createContext();
      ctx.resumeSession = false;
      const prompt = promptBuilder.buildPrompt(ctx);
      expect(prompt).toContain('You are a code reviewer');
      expect(prompt).toContain('Read CLAUDE.md');
      expect(prompt).not.toContain('you just saw being implemented');
    });
  });

  describe('inferOutcome', () => {
    it('returns failed for non-zero exit code', () => {
      expect(promptBuilder.inferOutcome('review', 1, '')).toBe('failed');
    });

    it('returns approved as default for zero exit code', () => {
      expect(promptBuilder.inferOutcome('review', 0, 'some output')).toBe('approved');
    });
  });

  describe('buildResult', () => {
    it('uses structuredOutput.verdict as authoritative outcome', () => {
      const so = {
        verdict: 'changes_requested',
        summary: 'Issues found',
        comments: [{ file: 'src/index.ts', severity: 'must_fix', issue: 'Fix imports', suggestion: 'Use named imports' }],
      };
      const libResult = { exitCode: 0, output: 'output text', costInputTokens: 100, costOutputTokens: 50, structuredOutput: so };
      const result = promptBuilder.buildResult(createContext(), libResult, 'approved', 'the prompt');
      expect(result.outcome).toBe('changes_requested');
      expect(result.payload).toBeDefined();
      expect(result.payload!.summary).toBe('Issues found');
      expect(result.payload!.comments).toEqual([{ file: 'src/index.ts', severity: 'must_fix', issue: 'Fix imports', suggestion: 'Use named imports' }]);
    });

    it('attaches payload only for changes_requested', () => {
      const so = { verdict: 'approved', summary: 'Looks good', comments: [] };
      const libResult = { exitCode: 0, output: 'output text', costInputTokens: 100, costOutputTokens: 50, structuredOutput: so };
      const result = promptBuilder.buildResult(createContext(), libResult, 'approved', 'the prompt');
      expect(result.outcome).toBe('approved');
      expect(result.payload).toBeUndefined();
    });

    it('falls back gracefully when structured output is absent', () => {
      const libResult = { exitCode: 0, output: 'some output text' };
      const result = promptBuilder.buildResult(createContext(), libResult, 'approved', 'the prompt');
      expect(result.outcome).toBe('approved');
      expect(result.payload).toBeUndefined();
    });

    it('falls back to output slice when structured output partial (no summary)', () => {
      const so = { verdict: 'changes_requested' } as Partial<{ verdict: string; summary: string; comments: Array<{ file: string; severity: string; issue: string; suggestion: string }> }>;
      const libResult = { exitCode: 0, output: 'a'.repeat(600), costInputTokens: 10, costOutputTokens: 5, structuredOutput: so };
      const result = promptBuilder.buildResult(createContext(), libResult, 'approved', 'the prompt');
      expect(result.outcome).toBe('changes_requested');
      expect(result.payload).toBeDefined();
      expect(result.payload!.summary).toBe('a'.repeat(500));
      expect(result.payload!.comments).toEqual([]);
    });

    it('preserves structuredOutput, prompt, and cost fields', () => {
      const so = { verdict: 'approved', summary: 'ok', comments: [] };
      const libResult = { exitCode: 0, output: 'text', costInputTokens: 200, costOutputTokens: 100, structuredOutput: so };
      const result = promptBuilder.buildResult(createContext(), libResult, 'approved', 'the prompt');
      expect(result.structuredOutput).toBe(so);
      expect(result.prompt).toBe('the prompt');
      expect(result.costInputTokens).toBe(200);
      expect(result.costOutputTokens).toBe(100);
    });
  });

  describe('execute() integration via Agent', () => {
    let composedAgent: Agent;
    let lib: ClaudeCodeLib;
    let mockQuery: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      lib = new ClaudeCodeLib();
      const registry = new AgentLibRegistry();
      registry.register(lib);
      composedAgent = new Agent('reviewer', new ReviewerPromptBuilder(), registry);
      mockQuery = vi.fn();

      // Mock the private loadQuery method on the lib to return our mock
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(lib as any, 'loadQuery').mockResolvedValue(mockQuery);
    });

    it('handles approved path with structured output', async () => {
      const messages = [
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Review looks good' }] },
        },
        {
          type: 'result',
          subtype: 'success',
          structured_output: { verdict: 'approved', summary: 'All good', comments: [] },
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      ];
      mockQuery.mockReturnValue(mockQueryGenerator(messages));

      const result = await composedAgent.execute(createContext(), {});
      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('approved');
      expect(result.payload).toBeUndefined();
      expect(result.structuredOutput).toEqual({ verdict: 'approved', summary: 'All good', comments: [] });
    });

    it('handles changes_requested path with structured output', async () => {
      const structuredComments = [
        { file: 'src/api/foo.ts', severity: 'must_fix', issue: 'Fix naming', suggestion: 'Use camelCase' },
        { file: 'tests/foo.test.ts', severity: 'should_fix', issue: 'Add tests', suggestion: 'Cover edge cases' },
      ];
      const messages = [
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Found issues' }] },
        },
        {
          type: 'result',
          subtype: 'success',
          structured_output: {
            verdict: 'changes_requested',
            summary: 'Several issues',
            comments: structuredComments,
          },
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      ];
      mockQuery.mockReturnValue(mockQueryGenerator(messages));

      const result = await composedAgent.execute(createContext(), {});
      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('changes_requested');
      expect(result.payload).toBeDefined();
      expect(result.payload!.summary).toBe('Several issues');
      expect(result.payload!.comments).toEqual(structuredComments);
    });

    it('handles error path', async () => {
      const messages = [
        {
          type: 'result',
          subtype: 'error_during_execution',
          errors: ['SDK error'],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ];
      mockQuery.mockReturnValue(mockQueryGenerator(messages));

      const result = await composedAgent.execute(createContext(), {});
      expect(result.exitCode).toBe(1);
      expect(result.outcome).toBe('failed');
      expect(result.error).toBe('SDK error');
    });
  });
});
