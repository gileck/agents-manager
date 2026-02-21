import { describe, it, expect } from 'vitest';
import { TimelineService } from '../../src/main/services/timeline/timeline-service';
import type { ITimelineSource } from '../../src/main/services/timeline/types';
import type { DebugTimelineEntry } from '../../src/shared/types';

function makeEntry(overrides: Partial<DebugTimelineEntry> = {}): DebugTimelineEntry {
  return {
    timestamp: 1000,
    source: 'event',
    severity: 'info',
    title: 'Test entry',
    ...overrides,
  };
}

function createSource(entries: DebugTimelineEntry[]): ITimelineSource {
  return {
    getEntries: (_taskId: string) => entries,
  };
}

describe('TimelineService', () => {
  describe('single source', () => {
    it('returns entries sorted descending by timestamp', () => {
      const entries = [
        makeEntry({ id: 'a', timestamp: 100, title: 'oldest' }),
        makeEntry({ id: 'b', timestamp: 300, title: 'newest' }),
        makeEntry({ id: 'c', timestamp: 200, title: 'middle' }),
      ];
      const service = new TimelineService([createSource(entries)]);

      const result = service.getTimeline('task-1');

      expect(result).toHaveLength(3);
      expect(result[0].title).toBe('newest');
      expect(result[1].title).toBe('middle');
      expect(result[2].title).toBe('oldest');
    });
  });

  describe('multiple sources', () => {
    it('merges entries from three sources sorted correctly', () => {
      const source1 = createSource([
        makeEntry({ id: 's1-a', timestamp: 100, title: 'src1-old' }),
        makeEntry({ id: 's1-b', timestamp: 400, title: 'src1-new' }),
      ]);
      const source2 = createSource([
        makeEntry({ id: 's2-a', timestamp: 200, title: 'src2-mid' }),
      ]);
      const source3 = createSource([
        makeEntry({ id: 's3-a', timestamp: 300, title: 'src3-mid2' }),
        makeEntry({ id: 's3-b', timestamp: 500, title: 'src3-newest' }),
      ]);
      const service = new TimelineService([source1, source2, source3]);

      const result = service.getTimeline('task-1');

      expect(result).toHaveLength(5);
      expect(result.map(e => e.title)).toEqual([
        'src3-newest',
        'src1-new',
        'src3-mid2',
        'src2-mid',
        'src1-old',
      ]);
    });
  });

  describe('deduplication', () => {
    it('removes duplicate entries with the same id', () => {
      const source1 = createSource([
        makeEntry({ id: 'dup-1', timestamp: 100, title: 'from-source-1' }),
      ]);
      const source2 = createSource([
        makeEntry({ id: 'dup-1', timestamp: 100, title: 'from-source-2' }),
      ]);
      const service = new TimelineService([source1, source2]);

      const result = service.getTimeline('task-1');

      expect(result).toHaveLength(1);
      // The first one encountered should win
      expect(result[0].title).toBe('from-source-1');
    });

    it('deduplicates entries without id using timestamp+source+title key', () => {
      const source1 = createSource([
        makeEntry({ timestamp: 100, source: 'event', title: 'same' }),
      ]);
      const source2 = createSource([
        makeEntry({ timestamp: 100, source: 'event', title: 'same' }),
      ]);
      const service = new TimelineService([source1, source2]);

      const result = service.getTimeline('task-1');

      expect(result).toHaveLength(1);
    });

    it('does not deduplicate entries with different ids', () => {
      const source1 = createSource([
        makeEntry({ id: 'unique-1', timestamp: 100, title: 'entry 1' }),
      ]);
      const source2 = createSource([
        makeEntry({ id: 'unique-2', timestamp: 100, title: 'entry 2' }),
      ]);
      const service = new TimelineService([source1, source2]);

      const result = service.getTimeline('task-1');

      expect(result).toHaveLength(2);
    });
  });

  describe('pagination with before', () => {
    it('only returns entries with timestamp < before', () => {
      const entries = [
        makeEntry({ id: 'a', timestamp: 100 }),
        makeEntry({ id: 'b', timestamp: 200 }),
        makeEntry({ id: 'c', timestamp: 300 }),
        makeEntry({ id: 'd', timestamp: 400 }),
      ];
      const service = new TimelineService([createSource(entries)]);

      const result = service.getTimeline('task-1', { before: 300 });

      expect(result).toHaveLength(2);
      expect(result.map(e => e.id)).toEqual(['b', 'a']);
    });

    it('returns empty when before is smaller than all timestamps', () => {
      const entries = [
        makeEntry({ id: 'a', timestamp: 100 }),
        makeEntry({ id: 'b', timestamp: 200 }),
      ];
      const service = new TimelineService([createSource(entries)]);

      const result = service.getTimeline('task-1', { before: 50 });

      expect(result).toHaveLength(0);
    });
  });

  describe('limit', () => {
    it('returns at most limit entries', () => {
      const entries = [
        makeEntry({ id: 'a', timestamp: 100 }),
        makeEntry({ id: 'b', timestamp: 200 }),
        makeEntry({ id: 'c', timestamp: 300 }),
        makeEntry({ id: 'd', timestamp: 400 }),
        makeEntry({ id: 'e', timestamp: 500 }),
      ];
      const service = new TimelineService([createSource(entries)]);

      const result = service.getTimeline('task-1', { limit: 3 });

      expect(result).toHaveLength(3);
      // Should be the 3 most recent (descending)
      expect(result.map(e => e.id)).toEqual(['e', 'd', 'c']);
    });

    it('returns all entries when limit exceeds count', () => {
      const entries = [
        makeEntry({ id: 'a', timestamp: 100 }),
        makeEntry({ id: 'b', timestamp: 200 }),
      ];
      const service = new TimelineService([createSource(entries)]);

      const result = service.getTimeline('task-1', { limit: 10 });

      expect(result).toHaveLength(2);
    });

    it('limit 0 does not apply limit filtering', () => {
      const entries = [
        makeEntry({ id: 'a', timestamp: 100 }),
        makeEntry({ id: 'b', timestamp: 200 }),
      ];
      const service = new TimelineService([createSource(entries)]);

      // limit: 0 is handled as "falsy" since the code checks > 0
      const result = service.getTimeline('task-1', { limit: 0 });

      expect(result).toHaveLength(2);
    });
  });

  describe('combined before and limit', () => {
    it('applies before filter then limit', () => {
      const entries = [
        makeEntry({ id: 'a', timestamp: 100 }),
        makeEntry({ id: 'b', timestamp: 200 }),
        makeEntry({ id: 'c', timestamp: 300 }),
        makeEntry({ id: 'd', timestamp: 400 }),
        makeEntry({ id: 'e', timestamp: 500 }),
      ];
      const service = new TimelineService([createSource(entries)]);

      const result = service.getTimeline('task-1', { before: 400, limit: 2 });

      expect(result).toHaveLength(2);
      expect(result.map(e => e.id)).toEqual(['c', 'b']);
    });
  });

  describe('empty sources', () => {
    it('returns empty array when no sources', () => {
      const service = new TimelineService([]);

      const result = service.getTimeline('task-1');

      expect(result).toEqual([]);
    });

    it('returns empty array when all sources return empty', () => {
      const service = new TimelineService([
        createSource([]),
        createSource([]),
      ]);

      const result = service.getTimeline('task-1');

      expect(result).toEqual([]);
    });
  });
});
