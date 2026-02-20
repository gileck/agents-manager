import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrReviewerAgent } from '../../src/main/agents/pr-reviewer-agent';
import type { AgentContext } from '../../src/shared/types';

function createContext(taskId: string = 'test-task'): AgentContext {
  return {
    task: { id: taskId, title: 'Test task', projectId: 'proj-1', pipelineId: 'pipe-1', status: 'reviewing', priority: 0, tags: [], metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
    mode: 'review',
    workdir: '/tmp/test',
    project: { id: 'proj-1', name: 'Test Project', path: '/tmp/test' },
  } as AgentContext;
}

async function* mockQueryGenerator(messages: any[]) {
  for (const msg of messages) {
    yield msg;
  }
}

describe('PrReviewerAgent', () => {
  let agent: PrReviewerAgent;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    agent = new PrReviewerAgent();
    mockQuery = vi.fn();
    vi.spyOn(agent as any, 'loadQuery').mockResolvedValue(mockQuery);
  });

  describe('getOutputFormat', () => {
    it('returns correct schema shape with enum-restricted verdict', () => {
      const format = (agent as any).getOutputFormat(createContext()) as any;
      expect(format).toBeDefined();
      expect(format.type).toBe('json_schema');
      expect(format.schema.type).toBe('object');
      expect(format.schema.required).toEqual(['verdict', 'summary', 'comments']);
      expect(format.schema.properties.verdict.enum).toEqual(['approved', 'changes_requested']);
      expect(format.schema.properties.comments.type).toBe('array');
    });
  });

  describe('buildPrompt', () => {
    it('contains JSON field descriptions and no REVIEW_VERDICT text', () => {
      const prompt = agent.buildPrompt(createContext());
      expect(prompt).toContain('"verdict"');
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"comments"');
      expect(prompt).not.toContain('REVIEW_VERDICT');
    });

    it('includes re-review notice when prior review exists', () => {
      const ctx = createContext();
      ctx.taskContext = [
        { source: 'agent', entryType: 'review_feedback', summary: 'needs changes', createdAt: Date.now() },
      ];
      const prompt = agent.buildPrompt(ctx);
      expect(prompt).toContain('RE-REVIEW');
      expect(prompt).toContain('Verify ALL previously requested changes');
    });

    it('does not include re-review notice without prior review', () => {
      const prompt = agent.buildPrompt(createContext());
      expect(prompt).not.toContain('RE-REVIEW');
    });

    it('uses project defaultBranch', () => {
      const ctx = createContext();
      ctx.project = { id: 'proj-1', name: 'Test', path: '/tmp', config: { defaultBranch: 'develop' } } as any;
      const prompt = agent.buildPrompt(ctx);
      expect(prompt).toContain('git diff develop..HEAD');
    });

    it('defaults to main when no defaultBranch configured', () => {
      const prompt = agent.buildPrompt(createContext());
      expect(prompt).toContain('git diff main..HEAD');
    });
  });

  describe('inferOutcome', () => {
    it('returns failed for non-zero exit code', () => {
      expect(agent.inferOutcome('review', 1, '')).toBe('failed');
    });

    it('returns approved as default for zero exit code', () => {
      expect(agent.inferOutcome('review', 0, 'some output')).toBe('approved');
    });
  });

  describe('buildResult', () => {
    it('uses structuredOutput.verdict as authoritative outcome', () => {
      const so = { verdict: 'changes_requested', summary: 'Issues found', comments: ['Fix imports'] };
      const result = agent.buildResult(0, 'output text', 'approved', undefined, 100, 50, so);
      expect(result.outcome).toBe('changes_requested');
      expect(result.payload).toBeDefined();
      expect(result.payload!.summary).toBe('Issues found');
      expect(result.payload!.comments).toEqual(['Fix imports']);
    });

    it('attaches payload only for changes_requested', () => {
      const so = { verdict: 'approved', summary: 'Looks good', comments: [] };
      const result = agent.buildResult(0, 'output text', 'approved', undefined, 100, 50, so);
      expect(result.outcome).toBe('approved');
      expect(result.payload).toBeUndefined();
    });

    it('falls back gracefully when structured output is absent', () => {
      const result = agent.buildResult(0, 'some output text', 'approved');
      expect(result.outcome).toBe('approved');
      expect(result.payload).toBeUndefined();
    });

    it('falls back to output slice when structured output partial (no summary)', () => {
      const so = { verdict: 'changes_requested' } as any;
      const result = agent.buildResult(0, 'a'.repeat(600), 'approved', undefined, 10, 5, so);
      expect(result.outcome).toBe('changes_requested');
      expect(result.payload).toBeDefined();
      expect(result.payload!.summary).toBe('a'.repeat(500));
      expect(result.payload!.comments).toEqual([]);
    });

    it('preserves structuredOutput, prompt, and cost fields', () => {
      const so = { verdict: 'approved', summary: 'ok', comments: [] };
      const result = agent.buildResult(0, 'text', 'approved', undefined, 200, 100, so, 'the prompt');
      expect(result.structuredOutput).toBe(so);
      expect(result.prompt).toBe('the prompt');
      expect(result.costInputTokens).toBe(200);
      expect(result.costOutputTokens).toBe(100);
    });
  });

  describe('execute() integration', () => {
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

      const result = await agent.execute(createContext(), {});
      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('approved');
      expect(result.payload).toBeUndefined();
      expect(result.structuredOutput).toEqual({ verdict: 'approved', summary: 'All good', comments: [] });
    });

    it('handles changes_requested path with structured output', async () => {
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
            comments: ['Fix naming', 'Add tests'],
          },
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      ];
      mockQuery.mockReturnValue(mockQueryGenerator(messages));

      const result = await agent.execute(createContext(), {});
      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('changes_requested');
      expect(result.payload).toBeDefined();
      expect(result.payload!.summary).toBe('Several issues');
      expect(result.payload!.comments).toEqual(['Fix naming', 'Add tests']);
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

      const result = await agent.execute(createContext(), {});
      expect(result.exitCode).toBe(1);
      expect(result.outcome).toBe('failed');
      expect(result.error).toBe('SDK error');
    });
  });
});
