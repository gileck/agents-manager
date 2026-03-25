/**
 * Unit tests for buildDocsPromptSections() and findDoc() from doc-injection.ts.
 *
 * Tests the "full latest + summary rest" injection strategy used by prompt builders.
 */

import { describe, it, expect } from 'vitest';
import { buildDocsPromptSections, buildGenericDocsSection, findDoc } from '../../src/core/agents/doc-injection';
import type { TaskDoc } from '../../src/shared/types';

function makeDoc(type: TaskDoc['type'], content: string, summary?: string | null): TaskDoc {
  return {
    id: `doc-${type}`,
    taskId: 'task-1',
    type,
    content,
    summary: summary ?? null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

describe('buildDocsPromptSections', () => {
  it('returns empty string when docs array is empty', () => {
    expect(buildDocsPromptSections([], 'plan')).toBe('');
  });

  it('returns empty string when docs is null-ish', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(buildDocsPromptSections(null as any, 'plan')).toBe('');
  });

  it('includes the primary doc in full', () => {
    const docs = [makeDoc('plan', '# Full Plan Content')];
    const result = buildDocsPromptSections(docs, 'plan');
    expect(result).toContain('## Plan');
    expect(result).toContain('# Full Plan Content');
  });

  it('includes other docs as summaries when summary is available', () => {
    const docs = [
      makeDoc('plan', '# Full Plan', 'Plan summary here'),
      makeDoc('investigation_report', '# Full Report', 'Report summary'),
    ];
    const result = buildDocsPromptSections(docs, 'plan');

    // Primary doc (plan) should be in full
    expect(result).toContain('# Full Plan');

    // Other doc (investigation_report) should show summary
    expect(result).toContain('Investigation Report (Summary)');
    expect(result).toContain('Report summary');
    expect(result).not.toContain('# Full Report');
  });

  it('shows read_task_artifact hint when other doc has no summary', () => {
    const docs = [
      makeDoc('plan', '# Full Plan'),
      makeDoc('technical_design', '# Design Content', null),
    ];
    const result = buildDocsPromptSections(docs, 'plan');

    // Should show the fallback hint for design since it has no summary
    expect(result).toContain('Technical Design (Summary)');
    expect(result).toContain('read_task_artifact');
    expect(result).toContain('technical_design');
    expect(result).not.toContain('# Design Content');
  });

  it('handles all three doc types together', () => {
    const docs = [
      makeDoc('investigation_report', '# Investigation', 'Short investigation'),
      makeDoc('plan', '# Plan', 'Short plan'),
      makeDoc('technical_design', '# Design', 'Short design'),
    ];
    const result = buildDocsPromptSections(docs, 'technical_design');

    // Primary doc (technical_design) in full
    expect(result).toContain('# Design');

    // Others as summaries
    expect(result).toContain('Investigation Report (Summary)');
    expect(result).toContain('Short investigation');
    expect(result).toContain('Plan (Summary)');
    expect(result).toContain('Short plan');
  });

  it('skips other docs that have neither summary nor content', () => {
    const docs = [
      makeDoc('plan', '# Plan Content'),
      { ...makeDoc('technical_design', '', null), content: '' } as TaskDoc,
    ];
    const result = buildDocsPromptSections(docs, 'plan');
    expect(result).toContain('# Plan Content');
    // Empty-content doc should not appear
    expect(result).not.toContain('Technical Design');
  });

  it('returns only full content when only primary doc exists', () => {
    const docs = [makeDoc('plan', '# Solo Plan')];
    const result = buildDocsPromptSections(docs, 'plan');
    expect(result).toContain('## Plan');
    expect(result).toContain('# Solo Plan');
    // Should not contain Summary sections
    expect(result).not.toContain('(Summary)');
  });

  it('handles case when primary doc is missing from docs array', () => {
    const docs = [makeDoc('investigation_report', '# Report', 'Report summary')];
    const result = buildDocsPromptSections(docs, 'plan');
    // Should still include the investigation_report as a summary (since it is "other")
    expect(result).toContain('Investigation Report (Summary)');
    expect(result).toContain('Report summary');
  });
});

describe('buildGenericDocsSection', () => {
  it('returns empty string when docs is undefined', () => {
    expect(buildGenericDocsSection(undefined)).toBe('');
  });

  it('returns empty string when docs array is empty', () => {
    expect(buildGenericDocsSection([])).toBe('');
  });

  it('renders all docs as summaries with read_task_artifact instruction', () => {
    const docs = [
      makeDoc('investigation_report', '# Full Report', 'Short report summary'),
      makeDoc('plan', '# Full Plan', 'Short plan summary'),
    ];
    const result = buildGenericDocsSection(docs);

    // Header
    expect(result).toContain('## Available Task Documents');
    expect(result).toContain('read_task_artifact');

    // Investigation report section
    expect(result).toContain('### Investigation Report');
    expect(result).toContain('Short report summary');
    expect(result).toContain('type=`investigation_report`');
    expect(result).not.toContain('# Full Report');

    // Plan section
    expect(result).toContain('### Plan');
    expect(result).toContain('Short plan summary');
    expect(result).toContain('type=`plan`');
    expect(result).not.toContain('# Full Plan');
  });

  it('shows fallback hint when doc has content but no summary', () => {
    const docs = [makeDoc('technical_design', '# Design Content', null)];
    const result = buildGenericDocsSection(docs);

    expect(result).toContain('### Technical Design');
    expect(result).toContain('type=`technical_design`');
    expect(result).toContain('Document available');
    expect(result).not.toContain('# Design Content');
  });

  it('skips docs with neither summary nor content', () => {
    const docs = [{ ...makeDoc('plan', '', null), content: '' } as TaskDoc];
    const result = buildGenericDocsSection(docs);
    // Header is present but no doc entries
    expect(result).not.toContain('### Plan');
  });

  it('includes type metadata for each doc', () => {
    const docs = [makeDoc('plan', '# Plan', 'Summary')];
    const result = buildGenericDocsSection(docs);
    expect(result).toContain('**Type:** `plan`');
  });

  it('renders single doc correctly', () => {
    const docs = [makeDoc('investigation_report', '# Full Report', 'Summary of investigation')];
    const result = buildGenericDocsSection(docs);

    expect(result).toContain('## Available Task Documents');
    expect(result).toContain('### Investigation Report');
    expect(result).toContain('Summary of investigation');
    expect(result).toContain('type=`investigation_report`');
  });
});

describe('findDoc', () => {
  it('returns the matching doc', () => {
    const docs = [
      makeDoc('plan', '# Plan'),
      makeDoc('technical_design', '# Design'),
    ];
    const result = findDoc(docs, 'plan');
    expect(result).toBeDefined();
    expect(result?.type).toBe('plan');
  });

  it('returns undefined when no match', () => {
    const docs = [makeDoc('plan', '# Plan')];
    expect(findDoc(docs, 'technical_design')).toBeUndefined();
  });

  it('returns undefined when docs is undefined', () => {
    expect(findDoc(undefined, 'plan')).toBeUndefined();
  });

  it('returns undefined when docs is empty', () => {
    expect(findDoc([], 'plan')).toBeUndefined();
  });
});
