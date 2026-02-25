import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteChatSessionStore } from '../../src/main/stores/sqlite-chat-session-store';
import type { ChatSessionCreateInput } from '../../src/main/interfaces/chat-session-store';

describe('SqliteChatSessionStore', () => {
  let db: Database.Database;
  let store: SqliteChatSessionStore;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');

    // Create the necessary tables
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE project_chat_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_chat_sessions_project ON project_chat_sessions(project_id);
    `);

    // Insert a test project
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run('project-1', 'Test Project');

    store = new SqliteChatSessionStore(db);
  });

  describe('createSession', () => {
    it('should create a new session successfully', async () => {
      const input: ChatSessionCreateInput = {
        projectId: 'project-1',
        name: 'Test Session',
      };

      const session = await store.createSession(input);

      expect(session).toMatchObject({
        projectId: 'project-1',
        name: 'Test Session',
      });
      expect(session.id).toBeTruthy();
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.updatedAt).toBeGreaterThan(0);
    });

    it('should throw error when creating session with invalid project ID', async () => {
      const input: ChatSessionCreateInput = {
        projectId: 'non-existent-project',
        name: 'Test Session',
      };

      await expect(store.createSession(input)).rejects.toThrow('Failed to create chat session');
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const created = await store.createSession({
        projectId: 'project-1',
        name: 'Test Session',
      });

      const retrieved = await store.getSession(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent session', async () => {
      const result = await store.getSession('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('listSessionsForProject', () => {
    it('should list all sessions for a project', async () => {
      await store.createSession({ projectId: 'project-1', name: 'Session 1' });
      await store.createSession({ projectId: 'project-1', name: 'Session 2' });

      const sessions = await store.listSessionsForProject('project-1');

      expect(sessions).toHaveLength(2);
      expect(sessions[0].name).toBe('Session 1');
      expect(sessions[1].name).toBe('Session 2');
    });

    it('should return empty array for project with no sessions', async () => {
      const sessions = await store.listSessionsForProject('project-1');
      expect(sessions).toEqual([]);
    });
  });

  describe('updateSession', () => {
    it('should update session name successfully', async () => {
      const created = await store.createSession({
        projectId: 'project-1',
        name: 'Original Name',
      });

      const updated = await store.updateSession(created.id, { name: 'Updated Name' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.updatedAt).toBeGreaterThan(created.updatedAt);
    });

    it('should return null when updating non-existent session', async () => {
      const result = await store.updateSession('non-existent-id', { name: 'New Name' });
      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('should delete session successfully', async () => {
      const created = await store.createSession({
        projectId: 'project-1',
        name: 'To Delete',
      });

      const deleted = await store.deleteSession(created.id);
      expect(deleted).toBe(true);

      const retrieved = await store.getSession(created.id);
      expect(retrieved).toBeNull();
    });

    it('should return false when deleting non-existent session', async () => {
      const result = await store.deleteSession('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Drop the table to cause an error
      db.exec('DROP TABLE project_chat_sessions');

      await expect(store.createSession({ projectId: 'project-1', name: 'Test' }))
        .rejects.toThrow('Failed to create chat session');

      await expect(store.getSession('test-id'))
        .rejects.toThrow('Failed to get chat session');

      await expect(store.listSessionsForProject('project-1'))
        .rejects.toThrow('Failed to list chat sessions');
    });
  });
});