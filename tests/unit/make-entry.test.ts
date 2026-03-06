import { describe, it, expect } from 'vitest';
import { makeEntry } from '../../src/core/services/timeline/make-entry';

describe('makeEntry', () => {
  describe('id hashing', () => {
    it('produces the same id for two entries with identical timestamp, source, title, and category', () => {
      const a = makeEntry(1000, 'event', 'info', 'same title', { category: 'hook_execution' });
      const b = makeEntry(1000, 'event', 'info', 'same title', { category: 'hook_execution' });

      expect(a.id).toBe(b.id);
    });

    it('produces different ids for same timestamp/source/title but different data.category', () => {
      const systemEntry = makeEntry(1000, 'event', 'info', 'same title', { category: 'system' });
      const hookEntry = makeEntry(1000, 'event', 'info', 'same title', { category: 'hook_execution' });

      expect(systemEntry.id).not.toBe(hookEntry.id);
    });

    it('produces different ids when no category vs category present', () => {
      const withoutCategory = makeEntry(1000, 'event', 'info', 'same title');
      const withCategory = makeEntry(1000, 'event', 'info', 'same title', { category: 'system' });

      expect(withoutCategory.id).not.toBe(withCategory.id);
    });

    it('produces the same id for two entries with no data', () => {
      const a = makeEntry(1000, 'event', 'info', 'same title');
      const b = makeEntry(1000, 'event', 'info', 'same title');

      expect(a.id).toBe(b.id);
    });

    it('includes all expected fields in the returned entry', () => {
      const entry = makeEntry(9999, 'llm', 'warn', 'my title', { foo: 'bar' });

      expect(entry.timestamp).toBe(9999);
      expect(entry.source).toBe('llm');
      expect(entry.severity).toBe('warn');
      expect(entry.title).toBe('my title');
      expect(entry.data).toEqual({ foo: 'bar' });
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
    });

    it('omits the data field when no data is provided', () => {
      const entry = makeEntry(1000, 'event', 'info', 'no data');

      expect(Object.prototype.hasOwnProperty.call(entry, 'data')).toBe(false);
    });
  });
});
