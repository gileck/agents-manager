import { describe, it, expect, beforeEach } from 'vitest';
import { TaskWorkflowReviewerPromptBuilder } from '../../src/core/agents/task-workflow-reviewer-prompt-builder';
import type { AgentContext, AgentConfig } from '../../src/shared/types';

function createContext(): AgentContext {
  return {
    task: {
      id: 'task-1',
      projectId: 'proj-1',
      pipelineId: 'pipe-1',
      title: 'Test task',
      description: null,
      status: 'reviewing',
      priority: 0,
      tags: [],
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    mode: 'new',
    workdir: '/tmp/test',
    project: { id: 'proj-1', name: 'Test Project', path: '/tmp/test', description: null, config: {}, createdAt: Date.now(), updatedAt: Date.now() },
  };
}

describe('TaskWorkflowReviewerPromptBuilder', () => {
  let promptBuilder: TaskWorkflowReviewerPromptBuilder;

  beforeEach(() => {
    promptBuilder = new TaskWorkflowReviewerPromptBuilder();
  });

  describe('type', () => {
    it('has correct type string', () => {
      expect(promptBuilder.type).toBe('task-workflow-reviewer');
    });
  });

  describe('isReadOnly', () => {
    it('returns true', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (promptBuilder as any).isReadOnly();
      expect(result).toBe(true);
    });

    it('produces readOnly=true in execution config', () => {
      const config: AgentConfig = {};
      const execConfig = promptBuilder.buildExecutionConfig(createContext(), config);
      expect(execConfig.readOnly).toBe(true);
    });
  });

  describe('getMaxTurns', () => {
    it('returns 50', () => {
      // Access protected method via cast
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (promptBuilder as any).getMaxTurns(createContext());
      expect(result).toBe(50);
    });
  });

  describe('getTimeout', () => {
    it('returns config.timeout when provided', () => {
      const config: AgentConfig = { timeout: 120000 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (promptBuilder as any).getTimeout(createContext(), config);
      expect(result).toBe(120000);
    });

    it('returns default 5 minutes when config.timeout is not set', () => {
      const config: AgentConfig = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (promptBuilder as any).getTimeout(createContext(), config);
      expect(result).toBe(5 * 60 * 1000);
    });

    it('returns default 5 minutes when config.timeout is 0 (falsy)', () => {
      const config: AgentConfig = { timeout: 0 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (promptBuilder as any).getTimeout(createContext(), config);
      expect(result).toBe(5 * 60 * 1000);
    });
  });

  describe('getOutputFormat', () => {
    it('returns a valid JSON schema object', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const format = (promptBuilder as any).getOutputFormat(createContext()) as {
        type: string;
        schema: {
          type: string;
          properties: Record<string, unknown>;
          required: string[];
        };
      };

      expect(format).toBeDefined();
      expect(format.type).toBe('json_schema');
      expect(format.schema.type).toBe('object');
    });

    it('contains expected required properties', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const format = (promptBuilder as any).getOutputFormat(createContext()) as {
        type: string;
        schema: {
          type: string;
          properties: Record<string, unknown>;
          required: string[];
        };
      };

      expect(format.schema.required).toEqual(
        expect.arrayContaining([
          'overallVerdict',
          'executionSummary',
          'findings',
          'promptImprovements',
          'processImprovements',
          'tokenCostAnalysis',
          'suggestedTasks',
        ])
      );
    });

    it('overallVerdict has correct enum values', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const format = (promptBuilder as any).getOutputFormat(createContext()) as {
        schema: {
          properties: {
            overallVerdict: { enum: string[] };
          };
        };
      };

      expect(format.schema.properties.overallVerdict.enum).toEqual([
        'good',
        'needs_improvement',
        'problematic',
      ]);
    });

    it('findings is an array type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const format = (promptBuilder as any).getOutputFormat(createContext()) as {
        schema: {
          properties: {
            findings: { type: string };
          };
        };
      };

      expect(format.schema.properties.findings.type).toBe('array');
    });

    it('suggestedTasks items schema includes debugInfo property', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const format = (promptBuilder as any).getOutputFormat(createContext()) as {
        schema: {
          properties: {
            suggestedTasks: {
              items: {
                properties: Record<string, { type: string }>;
              };
            };
          };
        };
      };

      const taskProps = format.schema.properties.suggestedTasks.items.properties;
      expect(taskProps.debugInfo).toBeDefined();
      expect(taskProps.debugInfo.type).toBe('string');
    });
  });

  describe('buildPrompt', () => {
    it('contains expected markers for navigation', () => {
      const prompt = promptBuilder.buildPrompt(createContext());

      expect(prompt).toContain('[[ SUMMARY:START/END ]]');
      expect(prompt).toContain('[[ AGENT_RUN:START');
      expect(prompt).toContain('[[ AGENT_RUN_OUTPUT:START');
      expect(prompt).toContain('[[ EVENT');
    });

    it('contains workflow steps', () => {
      const prompt = promptBuilder.buildPrompt(createContext());

      expect(prompt).toContain('## Investigation workflow');
      expect(prompt).toContain('Read the SUMMARY section');
      expect(prompt).toContain('Grep for "AGENT_RUN:START"');
      expect(prompt).toContain('root-cause findings');
    });

    it('contains review criteria sections', () => {
      const prompt = promptBuilder.buildPrompt(createContext());

      expect(prompt).toContain('## Review criteria');
      expect(prompt).toContain('Efficiency');
      expect(prompt).toContain('Infrastructure');
      expect(prompt).toContain('Process');
      expect(prompt).toContain('Error handling');
      expect(prompt).toContain('Cost');
    });

    it('mentions the report file', () => {
      const prompt = promptBuilder.buildPrompt(createContext());

      expect(prompt).toContain('.task-review-report.txt');
    });
  });

  describe('inferOutcome', () => {
    it('returns review_complete for exitCode 0', () => {
      const result = promptBuilder.inferOutcome('review', 0, 'output');
      expect(result).toBe('review_complete');
    });

    it('returns failed for non-zero exitCode', () => {
      const result = promptBuilder.inferOutcome('review', 1, 'error output');
      expect(result).toBe('failed');
    });

    it('returns failed for exitCode 2', () => {
      const result = promptBuilder.inferOutcome('review', 2, '');
      expect(result).toBe('failed');
    });
  });

  describe('buildResult (inherited from BaseAgentPromptBuilder)', () => {
    it('returns a properly structured result', () => {
      const libResult = { exitCode: 0, output: 'output text' };
      const result = promptBuilder.buildResult(createContext(), libResult, 'review_complete', 'the prompt');

      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('output text');
      expect(result.outcome).toBe('review_complete');
      expect(result.error).toBeUndefined();
    });

    it('includes error when provided', () => {
      const libResult = { exitCode: 1, output: '', error: 'Something went wrong' };
      const result = promptBuilder.buildResult(createContext(), libResult, 'failed', 'the prompt');

      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('Something went wrong');
    });

    it('includes cost and structured output when provided', () => {
      const so = { overallVerdict: 'good', executionSummary: 'All good' };
      const libResult = { exitCode: 0, output: 'text', costInputTokens: 200, costOutputTokens: 100, structuredOutput: so };
      const result = promptBuilder.buildResult(createContext(), libResult, 'review_complete', 'the prompt');

      expect(result.costInputTokens).toBe(200);
      expect(result.costOutputTokens).toBe(100);
      expect(result.structuredOutput).toBe(so);
      expect(result.prompt).toBe('the prompt');
    });
  });
});
