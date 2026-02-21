import { describe, it, expect } from 'vitest';
import { PromptRenderer } from '../../src/main/services/prompt-renderer';
import type { AgentContext, Task, Project, TaskContextEntry } from '../../src/shared/types';

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
  };
}

describe('PromptRenderer', () => {
  let renderer: PromptRenderer;

  beforeEach(() => {
    renderer = new PromptRenderer();
  });

  // ============================================
  // Basic template variable replacement
  // ============================================
  describe('Basic template variable replacement', () => {
    it('should replace {taskTitle} with the task title', () => {
      const result = renderer.render('Task: {taskTitle}', createContext());
      expect(result).toContain('Task: Implement login feature');
    });

    it('should replace {taskDescription} with the task description', () => {
      const result = renderer.render('Desc:{taskDescription}', createContext());
      expect(result).toContain('Desc: Add OAuth login support');
    });

    it('should replace {taskDescription} with empty string when description is null', () => {
      const ctx = createContext({ task: createTask({ description: null }) });
      const result = renderer.render('Desc:{taskDescription}', ctx);
      expect(result).toContain('Desc:');
      expect(result).not.toContain('null');
    });

    it('should replace {taskId} with the task id', () => {
      const result = renderer.render('ID: {taskId}', createContext());
      expect(result).toContain('ID: task-1');
    });

    it('should replace {defaultBranch} with the configured default branch', () => {
      const ctx = createContext({
        project: createProject({ config: { defaultBranch: 'develop' } }),
      });
      const result = renderer.render('Branch: {defaultBranch}', ctx);
      expect(result).toContain('Branch: develop');
    });

    it('should replace {defaultBranch} with "main" when not configured', () => {
      const result = renderer.render('Branch: {defaultBranch}', createContext());
      expect(result).toContain('Branch: main');
    });

    it('should replace multiple variables in the same template', () => {
      const result = renderer.render('{taskId}: {taskTitle}', createContext());
      expect(result).toContain('task-1: Implement login feature');
    });
  });

  // ============================================
  // Plan section rendering
  // ============================================
  describe('Plan section rendering', () => {
    it('should include plan section when task has a plan', () => {
      const ctx = createContext({ task: createTask({ plan: 'Step 1: Set up DB\nStep 2: Add API' }) });
      const result = renderer.render('{planSection}', ctx);
      expect(result).toContain('## Plan');
      expect(result).toContain('Step 1: Set up DB');
    });

    it('should omit plan section when task has no plan', () => {
      const result = renderer.render('{planSection}', createContext());
      expect(result).not.toContain('## Plan');
    });
  });

  // ============================================
  // Subtasks section rendering
  // ============================================
  describe('Subtasks section rendering', () => {
    it('should render subtask instruction for plan mode', () => {
      const ctx = createContext({ mode: 'plan' });
      const result = renderer.render('{subtasksSection}', ctx);
      expect(result).toContain('## Subtasks');
      expect(result).toContain('JSON array');
    });

    it('should render subtask instruction for investigate mode', () => {
      const ctx = createContext({ mode: 'investigate' });
      const result = renderer.render('{subtasksSection}', ctx);
      expect(result).toContain('## Subtasks');
    });

    it('should render subtask checklist when task has subtasks in implement mode', () => {
      const ctx = createContext({
        mode: 'implement',
        task: createTask({
          subtasks: [
            { name: 'Set up DB', status: 'done' },
            { name: 'Add API', status: 'open' },
          ],
        }),
      });
      const result = renderer.render('{subtasksSection}', ctx);
      expect(result).toContain('[x] Set up DB (done)');
      expect(result).toContain('[ ] Add API (open)');
      expect(result).toContain('Subtask Progress Tracking');
    });

    it('should return empty when implement mode has no subtasks', () => {
      const ctx = createContext({ mode: 'implement' });
      const result = renderer.render('Before{subtasksSection}After', ctx);
      expect(result).toContain('BeforeAfter');
    });
  });

  // ============================================
  // skipSummary
  // ============================================
  describe('skipSummary handling', () => {
    it('should append summary instruction when template does not contain {skipSummary}', () => {
      const result = renderer.render('Do some work', createContext());
      expect(result).toContain('## Summary');
      expect(result).toContain('briefly describes what you did');
    });

    it('should NOT append summary instruction when template contains {skipSummary}', () => {
      const result = renderer.render('Do some work {skipSummary}', createContext());
      expect(result).not.toContain('## Summary');
    });

    it('should replace {skipSummary} with empty string', () => {
      const result = renderer.render('Before{skipSummary}After', createContext());
      expect(result).toContain('BeforeAfter');
    });
  });

  // ============================================
  // Validation errors
  // ============================================
  describe('Validation errors', () => {
    it('should append validation errors when present', () => {
      const ctx = createContext({ validationErrors: 'Lint error: missing semicolon' });
      const result = renderer.render('Do work', ctx);
      expect(result).toContain('validation errors');
      expect(result).toContain('Lint error: missing semicolon');
    });

    it('should NOT append validation errors section when not present', () => {
      const result = renderer.render('Do work', createContext());
      expect(result).not.toContain('validation errors');
    });
  });

  // ============================================
  // Plan comments formatting
  // ============================================
  describe('Plan comments section', () => {
    it('should omit plan comments section when no comments', () => {
      const result = renderer.render('{planCommentsSection}', createContext());
      expect(result).not.toContain('Admin Feedback');
    });

    it('should format multiple comments correctly', () => {
      const ctx = createContext({
        task: createTask({
          planComments: [
            { author: 'alice', content: 'Looks good', createdAt: 1700000000000 },
            { author: 'bob', content: 'Add more tests', createdAt: 1700001000000 },
          ],
        }),
      });
      const result = renderer.render('{planCommentsSection}', ctx);
      expect(result).toContain('## Admin Feedback');
      expect(result).toContain('**alice**');
      expect(result).toContain('Looks good');
      expect(result).toContain('**bob**');
      expect(result).toContain('Add more tests');
    });
  });

  // ============================================
  // Technical design section
  // ============================================
  describe('Technical design section', () => {
    it('should include technical design when present', () => {
      const ctx = createContext({ task: createTask({ technicalDesign: 'Use microservices architecture' }) });
      const result = renderer.render('{technicalDesignSection}', ctx);
      expect(result).toContain('## Technical Design');
      expect(result).toContain('Use microservices architecture');
    });

    it('should omit technical design when not present', () => {
      const result = renderer.render('{technicalDesignSection}', createContext());
      expect(result).not.toContain('## Technical Design');
    });
  });

  // ============================================
  // Technical design comments
  // ============================================
  describe('Technical design comments section', () => {
    it('should format technical design comments', () => {
      const ctx = createContext({
        task: createTask({
          technicalDesignComments: [
            { author: 'lead', content: 'Consider caching', createdAt: 1700000000000 },
          ],
        }),
      });
      const result = renderer.render('{technicalDesignCommentsSection}', ctx);
      expect(result).toContain('## Admin Feedback on Design');
      expect(result).toContain('**lead**');
      expect(result).toContain('Consider caching');
    });

    it('should omit when no technical design comments', () => {
      const result = renderer.render('{technicalDesignCommentsSection}', createContext());
      expect(result).not.toContain('Admin Feedback on Design');
    });
  });

  // ============================================
  // Prior review section
  // ============================================
  describe('Prior review section', () => {
    it('should include prior review notice when review_feedback entries exist', () => {
      const taskContext: TaskContextEntry[] = [
        {
          id: 'ctx-1',
          taskId: 'task-1',
          agentRunId: 'run-1',
          source: 'review',
          entryType: 'review_feedback',
          summary: 'Previous review',
          data: {},
          createdAt: 1700000000000,
        },
      ];
      const ctx = createContext({ taskContext });
      const result = renderer.render('{priorReviewSection}', ctx);
      expect(result).toContain('RE-REVIEW');
    });

    it('should include prior review notice when fix_summary entries exist', () => {
      const taskContext: TaskContextEntry[] = [
        {
          id: 'ctx-2',
          taskId: 'task-1',
          agentRunId: 'run-1',
          source: 'fix',
          entryType: 'fix_summary',
          summary: 'Fixed issues',
          data: {},
          createdAt: 1700000000000,
        },
      ];
      const ctx = createContext({ taskContext });
      const result = renderer.render('{priorReviewSection}', ctx);
      expect(result).toContain('RE-REVIEW');
    });

    it('should omit prior review notice when no review context entries', () => {
      const result = renderer.render('{priorReviewSection}', createContext());
      expect(result).not.toContain('RE-REVIEW');
    });

    it('should omit prior review notice when taskContext is undefined', () => {
      const ctx = createContext({ taskContext: undefined });
      const result = renderer.render('{priorReviewSection}', ctx);
      expect(result).not.toContain('RE-REVIEW');
    });
  });

  // ============================================
  // Related task section
  // ============================================
  describe('Related task section', () => {
    it('should include related task info when metadata has relatedTaskId', () => {
      const ctx = createContext({
        task: createTask({ metadata: { relatedTaskId: 'task-99' } }),
      });
      const result = renderer.render('{relatedTaskSection}', ctx);
      expect(result).toContain('## Related Task');
      expect(result).toContain('task-99');
    });

    it('should omit related task section when no relatedTaskId', () => {
      const result = renderer.render('{relatedTaskSection}', createContext());
      expect(result).not.toContain('## Related Task');
    });
  });

  // ============================================
  // Skills section
  // ============================================
  describe('Skills section', () => {
    it('should render skills when provided', () => {
      const ctx = createContext({ skills: ['commit', 'review-pr', 'deploy'] });
      const result = renderer.render('{skillsSection}', ctx);
      expect(result).toContain('## Available Skills');
      expect(result).toContain('/commit');
      expect(result).toContain('/review-pr');
      expect(result).toContain('/deploy');
    });

    it('should omit skills section when no skills', () => {
      const result = renderer.render('{skillsSection}', createContext());
      expect(result).not.toContain('## Available Skills');
    });

    it('should omit skills section when skills array is empty', () => {
      const ctx = createContext({ skills: [] });
      const result = renderer.render('{skillsSection}', ctx);
      expect(result).not.toContain('## Available Skills');
    });
  });

  // ============================================
  // Edge cases
  // ============================================
  describe('Edge cases', () => {
    it('should return template as-is when no variables present (plus summary suffix)', () => {
      const result = renderer.render('No variables here', createContext());
      expect(result).toContain('No variables here');
    });

    it('should handle empty template', () => {
      const result = renderer.render('', createContext());
      // Should still get the summary suffix
      expect(result).toContain('## Summary');
    });

    it('should handle template with unknown placeholders (left as-is)', () => {
      const result = renderer.render('{unknownVariable}', createContext());
      expect(result).toContain('{unknownVariable}');
    });

    it('should handle dollar signs in task content without issues', () => {
      const ctx = createContext({
        task: createTask({ title: 'Fix $dollar $signs' }),
      });
      const result = renderer.render('{taskTitle}', ctx);
      expect(result).toContain('Fix $dollar $signs');
    });
  });
});
