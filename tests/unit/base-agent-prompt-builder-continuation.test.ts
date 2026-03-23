import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentContext, TaskContextEntry } from '../../src/shared/types';
import { BaseAgentPromptBuilder } from '../../src/core/agents/base-agent-prompt-builder';

/**
 * Concrete subclass of the abstract BaseAgentPromptBuilder for testing
 * the shared buildContinuationPrompt() method.
 */
class TestablePromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'testable';
  buildPrompt(): string { return 'test prompt'; }
  inferOutcome(_mode: string, exitCode: number): string { return exitCode === 0 ? 'success' : 'failed'; }
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    task: { id: 'task-1', title: 'Test Task', projectId: 'proj-1', pipelineId: 'pipe-1', status: 'in_progress' } as AgentContext['task'],
    mode: 'new',
    workdir: '/tmp/project',
    ...overrides,
  } as AgentContext;
}

function makeFeedbackEntry(overrides: Partial<TaskContextEntry> = {}): TaskContextEntry {
  return {
    id: 'ctx-1',
    taskId: 'task-1',
    entryType: 'plan_feedback',
    source: 'admin',
    summary: 'Please revise the naming conventions.',
    addressed: false,
    createdAt: Date.now(),
    ...overrides,
  } as TaskContextEntry;
}

describe('BaseAgentPromptBuilder — buildContinuationPrompt', () => {
  let builder: TestablePromptBuilder;

  beforeEach(() => {
    builder = new TestablePromptBuilder();
  });

  it('returns null when mode is not revision', () => {
    const result = builder.buildContinuationPrompt(makeContext({ mode: 'new' }));
    expect(result).toBeNull();
  });

  it('returns null when revisionReason is not set', () => {
    const result = builder.buildContinuationPrompt(makeContext({ mode: 'revision' }));
    expect(result).toBeNull();
  });

  it('returns null when there is no feedback and no custom prompt', () => {
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'changes_requested',
      taskContext: [],
    }));
    expect(result).toBeNull();
  });

  it('builds continuation prompt with changes_requested reason and feedback', () => {
    const feedback = makeFeedbackEntry({ summary: 'The plan needs better error handling.' });
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'changes_requested',
      taskContext: [feedback],
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('The user has provided new feedback');
    expect(result).toContain('## Feedback to Address');
    expect(result).toContain('The plan needs better error handling.');
    expect(result).toContain('Address every piece of feedback');
  });

  it('builds continuation prompt with info_provided reason', () => {
    const feedback = makeFeedbackEntry({
      entryType: 'plan_feedback',
      summary: 'Use JWT for authentication.',
    });
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'info_provided',
      taskContext: [feedback],
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('The user has provided answers to your questions');
    expect(result).toContain('Use JWT for authentication.');
    // info_provided should NOT include the "Address every piece" closing
    expect(result).not.toContain('Address every piece of feedback');
  });

  it('builds continuation prompt with merge_failed reason', () => {
    const feedback = makeFeedbackEntry({
      entryType: 'implementation_feedback',
      summary: 'Merge conflict in src/index.ts',
    });
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'merge_failed',
      taskContext: [feedback],
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('merge/rebase conflict');
  });

  it('builds continuation prompt with uncommitted_changes reason', () => {
    const feedback = makeFeedbackEntry({
      entryType: 'implementation_feedback',
      summary: 'Changes left unstaged.',
    });
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'uncommitted_changes',
      taskContext: [feedback],
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('uncommitted changes');
    expect(result).toContain('Stage and commit');
  });

  it('uses generic message for unknown revision reasons', () => {
    const feedback = makeFeedbackEntry({ summary: 'Something happened.' });
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'custom_reason' as AgentContext['revisionReason'],
      taskContext: [feedback],
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('reason: custom_reason');
  });

  it('excludes addressed feedback entries', () => {
    const unaddressed = makeFeedbackEntry({ id: 'ctx-1', summary: 'Fix naming.' });
    const addressed = makeFeedbackEntry({ id: 'ctx-2', summary: 'Already handled.', addressed: true });
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'changes_requested',
      taskContext: [unaddressed, addressed],
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('Fix naming.');
    expect(result).not.toContain('Already handled.');
  });

  it('excludes non-feedback entry types from feedback section', () => {
    const workEntry: TaskContextEntry = {
      id: 'ctx-w',
      taskId: 'task-1',
      entryType: 'agent_summary',
      source: 'planner',
      summary: 'Planner completed phase 1.',
      addressed: false,
      createdAt: Date.now(),
    } as TaskContextEntry;
    // No actual feedback entries → should return null when also no customPrompt
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'changes_requested',
      taskContext: [workEntry],
    }));

    expect(result).toBeNull();
  });

  it('includes custom prompt as Additional Instructions', () => {
    const feedback = makeFeedbackEntry({ summary: 'Revise module structure.' });
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'changes_requested',
      taskContext: [feedback],
      customPrompt: 'Also update the README.',
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('## Additional Instructions');
    expect(result).toContain('Also update the README.');
  });

  it('works with only custom prompt and no feedback entries', () => {
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'changes_requested',
      taskContext: [],
      customPrompt: 'Please continue where you left off.',
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('## Additional Instructions');
    expect(result).toContain('Please continue where you left off.');
    // Should NOT have a Feedback section since there are no entries
    expect(result).not.toContain('## Feedback to Address');
  });

  it('includes review comments from feedback data', () => {
    const feedback = makeFeedbackEntry({
      summary: 'Code review feedback',
      data: {
        comments: [
          { file: 'src/index.ts', severity: 'must_fix', issue: 'Missing null check', suggestion: 'Add nullish coalescing' },
        ],
      },
    });
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'changes_requested',
      taskContext: [feedback],
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('**Review Comments:**');
    expect(result).toContain('**[must_fix]**');
    expect(result).toContain('`src/index.ts`');
    expect(result).toContain('Missing null check');
    expect(result).toContain('Add nullish coalescing');
  });

  it('handles multiple feedback entries', () => {
    const feedback1 = makeFeedbackEntry({ id: 'ctx-1', summary: 'Fix error handling.' });
    const feedback2 = makeFeedbackEntry({
      id: 'ctx-2',
      entryType: 'review_feedback',
      source: 'reviewer',
      summary: 'Add input validation.',
    });
    const result = builder.buildContinuationPrompt(makeContext({
      mode: 'revision',
      revisionReason: 'changes_requested',
      taskContext: [feedback1, feedback2],
    }));

    expect(result).not.toBeNull();
    expect(result).toContain('Fix error handling.');
    expect(result).toContain('Add input validation.');
  });
});
