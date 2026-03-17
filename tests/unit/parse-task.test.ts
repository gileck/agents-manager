/**
 * Unit tests for parseTask() in TaskDetailCard.tsx.
 *
 * Validates parsing behavior for:
 *   - Full task objects with id + title
 *   - Partial field responses (missing id/title)
 *   - Error strings (non-JSON)
 *   - Truncated JSON
 *   - Empty objects
 */

import { describe, it, expect } from 'vitest';
import { parseTask } from '../../src/renderer/components/tool-renderers/TaskDetailCard';

describe('parseTask', () => {
  it('returns a full task when both id and title are present', () => {
    const input = JSON.stringify({
      id: 'abc-123',
      title: 'Fix login bug',
      status: 'todo',
      priority: 1,
      type: 'bug',
    });
    const { task, partial } = parseTask(input);
    expect(task).not.toBeNull();
    expect(task!.id).toBe('abc-123');
    expect(task!.title).toBe('Fix login bug');
    expect(partial).toBeNull();
  });

  it('returns partial when id is missing', () => {
    const input = JSON.stringify({
      title: 'Fix login bug',
      status: 'todo',
      plan: 'Step 1: investigate',
    });
    const { task, partial } = parseTask(input);
    expect(task).toBeNull();
    expect(partial).not.toBeNull();
    expect(partial!.title).toBe('Fix login bug');
    expect(partial!.status).toBe('todo');
  });

  it('returns partial when title is missing', () => {
    const input = JSON.stringify({
      id: 'abc-123',
      status: 'in_progress',
      plan: 'Some plan content',
    });
    const { task, partial } = parseTask(input);
    expect(task).toBeNull();
    expect(partial).not.toBeNull();
    expect(partial!.id).toBe('abc-123');
    expect(partial!.status).toBe('in_progress');
  });

  it('returns partial when both id and title are missing', () => {
    const input = JSON.stringify({
      status: 'done',
      plan: 'Completed plan',
    });
    const { task, partial } = parseTask(input);
    expect(task).toBeNull();
    expect(partial).not.toBeNull();
    expect(partial!.status).toBe('done');
  });

  it('returns null for both when given an error string (non-JSON)', () => {
    const input = 'Task not found: abc-123';
    const { task, partial } = parseTask(input);
    expect(task).toBeNull();
    expect(partial).toBeNull();
  });

  it('returns null for both when given truncated JSON', () => {
    const input = '{"id":"abc-123","title":"Fix login bug","plan":"Step 1: inv';
    const { task, partial } = parseTask(input);
    expect(task).toBeNull();
    expect(partial).toBeNull();
  });

  it('returns partial for an empty object', () => {
    const input = '{}';
    const { task, partial } = parseTask(input);
    expect(task).toBeNull();
    expect(partial).not.toBeNull();
    expect(Object.keys(partial!)).toHaveLength(0);
  });

  it('returns null for both when given a JSON array', () => {
    const input = JSON.stringify([{ id: 'abc', title: 'Test' }]);
    const { task, partial } = parseTask(input);
    expect(task).toBeNull();
    expect(partial).toBeNull();
  });

  it('returns null for both when given a primitive JSON value', () => {
    const { task: t1, partial: p1 } = parseTask('"just a string"');
    expect(t1).toBeNull();
    expect(p1).toBeNull();

    const { task: t2, partial: p2 } = parseTask('42');
    expect(t2).toBeNull();
    expect(p2).toBeNull();
  });

  it('returns null for both when given an empty string', () => {
    const { task, partial } = parseTask('');
    expect(task).toBeNull();
    expect(partial).toBeNull();
  });

  it('returns a full task with optional fields intact', () => {
    const taskData = {
      id: 'abc-123',
      title: 'Full task',
      status: 'implementing',
      plan: '# Plan\nStep 1',
      technicalDesign: '# Design\nArchitecture',
      description: 'A description',
      priority: 2,
      type: 'feature',
    };
    const { task, partial } = parseTask(JSON.stringify(taskData));
    expect(task).not.toBeNull();
    expect(task!.plan).toBe('# Plan\nStep 1');
    expect(task!.technicalDesign).toBe('# Design\nArchitecture');
    expect(partial).toBeNull();
  });
});
