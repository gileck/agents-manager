import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteChatSessionStore } from '../../src/core/stores/sqlite-chat-session-store';
import type { ChatSessionCreateInput } from '../../src/core/interfaces/chat-session-store';
import { applyMigrations } from '../helpers/test-context';

describe('SqliteChatSessionStore', () => {
  let db: Database.Database;
  let store: SqliteChatSessionStore;
  const testProjectId = 'project-test-1';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    applyMigrations(db);
    db.pragma('foreign_keys = ON');

    // Insert a test project and a test task so FK constraints pass
    db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      testProjectId, 'Test Project', Date.now(), Date.now(),
    );
    // Use the first available pipeline id from seeded data
    const pipeline = db.prepare('SELECT id FROM pipelines LIMIT 1').get() as { id: string };
    db.prepare(
      'INSERT INTO tasks (id, project_id, pipeline_id, title, status, priority, tags, subtasks, plan_comments, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('task-test-1', testProjectId, pipeline.id, 'Test Task', 'open', 'medium', '[]', '[]', '[]', '{}', Date.now(), Date.now());

    store = new SqliteChatSessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createSession', () => {
    it('should create a project-scoped session', async () => {
      const input: ChatSessionCreateInput = {
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Project Chat',
        projectId: testProjectId,
      };

      const session = await store.createSession(input);

      expect(session).toMatchObject({
        scopeType: 'project',
        scopeId: testProjectId,
        projectId: testProjectId,
        name: 'Project Chat',
        agentLib: null,
      });
      expect(session.id).toBeTruthy();
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.updatedAt).toBeGreaterThan(0);
    });

    it('should create a task-scoped session', async () => {
      const input: ChatSessionCreateInput = {
        scopeType: 'task',
        scopeId: 'task-test-1',
        name: 'Task Chat',
        projectId: testProjectId,
      };

      const session = await store.createSession(input);

      expect(session).toMatchObject({
        scopeType: 'task',
        scopeId: 'task-test-1',
        projectId: testProjectId,
        name: 'Task Chat',
      });
    });

    it('should create a session with agentLib', async () => {
      const input: ChatSessionCreateInput = {
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Agent Chat',
        agentLib: 'claude-code',
        projectId: testProjectId,
      };

      const session = await store.createSession(input);
      expect(session.agentLib).toBe('claude-code');
    });

    it('should default enableStreamingInput to true', async () => {
      const input: ChatSessionCreateInput = {
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Streaming Input Chat',
        projectId: testProjectId,
      };

      const session = await store.createSession(input);
      expect(session.enableStreamingInput).toBe(true);
    });

    it('should allow explicitly setting enableStreamingInput to false', async () => {
      const input: ChatSessionCreateInput = {
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'No Streaming Input Chat',
        projectId: testProjectId,
        enableStreamingInput: false,
      };

      const session = await store.createSession(input);
      expect(session.enableStreamingInput).toBe(false);
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const created = await store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Test Session',
        projectId: testProjectId,
      });

      const retrieved = await store.getSession(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should return null for a non-existent session', async () => {
      const result = await store.getSession('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('listSessionsForScope', () => {
    it('should list project-scoped sessions', async () => {
      await store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Session 1',
        projectId: testProjectId,
      });
      await store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Session 2',
        projectId: testProjectId,
      });

      const sessions = await store.listSessionsForScope('project', testProjectId);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].name).toBe('Session 1');
      expect(sessions[1].name).toBe('Session 2');
    });

    it('should list task-scoped sessions', async () => {
      await store.createSession({
        scopeType: 'task',
        scopeId: 'task-test-1',
        name: 'Task Session',
        projectId: testProjectId,
      });

      const sessions = await store.listSessionsForScope('task', 'task-test-1');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].name).toBe('Task Session');
    });

    it('should not mix scopes', async () => {
      await store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Project Session',
        projectId: testProjectId,
      });
      await store.createSession({
        scopeType: 'task',
        scopeId: 'task-test-1',
        name: 'Task Session',
        projectId: testProjectId,
      });

      const projectSessions = await store.listSessionsForScope('project', testProjectId);
      const taskSessions = await store.listSessionsForScope('task', 'task-test-1');

      expect(projectSessions).toHaveLength(1);
      expect(projectSessions[0].name).toBe('Project Session');
      expect(taskSessions).toHaveLength(1);
      expect(taskSessions[0].name).toBe('Task Session');
    });

    it('should return empty array for scope with no sessions', async () => {
      const sessions = await store.listSessionsForScope('project', testProjectId);
      expect(sessions).toEqual([]);
    });
  });

  describe('updateSession', () => {
    it('should update session name without changing updatedAt', async () => {
      const created = await store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Original Name',
        projectId: testProjectId,
      });

      const updated = await store.updateSession(created.id, { name: 'Updated Name' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      // updateSession should NOT bump updatedAt — only addMessage should,
      // so the sidebar sorts by last message time, not metadata edits.
      expect(updated!.updatedAt).toBe(created.updatedAt);
    });

    it('should update session agentLib', async () => {
      const created = await store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Chat',
        projectId: testProjectId,
      });

      const updated = await store.updateSession(created.id, { agentLib: 'claude-code' });

      expect(updated).not.toBeNull();
      expect(updated!.agentLib).toBe('claude-code');
    });

    it('should clear agentLib when set to null', async () => {
      const created = await store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Chat',
        agentLib: 'claude-code',
        projectId: testProjectId,
      });

      const updated = await store.updateSession(created.id, { agentLib: null });

      expect(updated).not.toBeNull();
      expect(updated!.agentLib).toBeNull();
    });

    it('should return null when updating a non-existent session', async () => {
      const result = await store.updateSession('non-existent-id', { name: 'New Name' });
      expect(result).toBeNull();
    });

    it('should return current session when no fields are provided', async () => {
      const created = await store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Chat',
        projectId: testProjectId,
      });

      const result = await store.updateSession(created.id, {});
      expect(result).toEqual(created);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', async () => {
      const created = await store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'To Delete',
        projectId: testProjectId,
      });

      const deleted = await store.deleteSession(created.id);
      expect(deleted).toBe(true);

      const retrieved = await store.getSession(created.id);
      expect(retrieved).toBeNull();
    });

    it('should return false when deleting a non-existent session', async () => {
      const result = await store.deleteSession('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw wrapped errors on database failures', async () => {
      db.exec('DROP TABLE chat_sessions');

      await expect(store.createSession({
        scopeType: 'project',
        scopeId: testProjectId,
        name: 'Test',
        projectId: testProjectId,
      })).rejects.toThrow('Failed to create chat session');

      await expect(store.getSession('test-id'))
        .rejects.toThrow('Failed to get chat session');

      await expect(store.listSessionsForScope('project', testProjectId))
        .rejects.toThrow('Failed to list chat sessions');

      await expect(store.updateSession('test-id', { name: 'New' }))
        .rejects.toThrow('Failed to update chat session');

      await expect(store.deleteSession('test-id'))
        .rejects.toThrow('Failed to delete chat session');
    });
  });
});
