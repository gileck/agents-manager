import { describe, it, expect } from 'vitest';
import {
  isDefaultSessionName,
  isAutoNameableSession,
  THEMED_SESSION_LABELS,
} from '../../src/core/services/chat-agent/chat-agent-helpers';

describe('isDefaultSessionName', () => {
  it('returns true for "General"', () => {
    expect(isDefaultSessionName('General')).toBe(true);
  });

  it('returns true for "Session N" pattern', () => {
    expect(isDefaultSessionName('Session 1')).toBe(true);
    expect(isDefaultSessionName('Session 42')).toBe(true);
  });

  it('returns false for themed labels', () => {
    expect(isDefaultSessionName('Feature Request')).toBe(false);
    expect(isDefaultSessionName('Bug Report')).toBe(false);
  });

  it('returns false for custom names', () => {
    expect(isDefaultSessionName('My Custom Thread')).toBe(false);
  });
});

describe('THEMED_SESSION_LABELS', () => {
  it('contains all four themed thread labels', () => {
    expect(THEMED_SESSION_LABELS).toHaveProperty('Feature Request');
    expect(THEMED_SESSION_LABELS).toHaveProperty('Bug Report');
    expect(THEMED_SESSION_LABELS).toHaveProperty('Improvement');
    expect(THEMED_SESSION_LABELS).toHaveProperty('Debug / Investigate');
  });
});

describe('isAutoNameableSession', () => {
  it('returns true for default session names', () => {
    expect(isAutoNameableSession('General')).toBe(true);
    expect(isAutoNameableSession('Session 1')).toBe(true);
    expect(isAutoNameableSession('Session 99')).toBe(true);
  });

  it('returns true for themed thread labels', () => {
    expect(isAutoNameableSession('Feature Request')).toBe(true);
    expect(isAutoNameableSession('Bug Report')).toBe(true);
    expect(isAutoNameableSession('Improvement')).toBe(true);
    expect(isAutoNameableSession('Debug / Investigate')).toBe(true);
  });

  it('returns false for user-customized session names', () => {
    expect(isAutoNameableSession('My Custom Thread')).toBe(false);
    expect(isAutoNameableSession('Dark Mode Implementation')).toBe(false);
    expect(isAutoNameableSession('Fix login bug')).toBe(false);
  });

  it('returns false for partial or case-mismatched themed labels', () => {
    expect(isAutoNameableSession('feature request')).toBe(false);
    expect(isAutoNameableSession('Feature')).toBe(false);
    expect(isAutoNameableSession('Bug')).toBe(false);
  });
});
