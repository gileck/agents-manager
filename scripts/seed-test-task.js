#!/usr/bin/env node

/**
 * Seeds the database with a test task
 * Run this after the app has been started at least once (to create the DB)
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'task-manager', 'tasks.db');
const scriptPath = path.join(__dirname, 'test-task.js');

console.log('Database path:', dbPath);
console.log('Script path:', scriptPath);

try {
  const db = new Database(dbPath);

  // Check if test task already exists
  const existing = db.prepare("SELECT id FROM tasks WHERE name = '20-Second Test Task'").get();

  if (existing) {
    console.log('Test task already exists, skipping...');
  } else {
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO tasks (
        id, name, description, script_path, script_args, working_directory,
        environment_variables, schedule_type, schedule_value, retry_enabled,
        retry_max_attempts, retry_backoff_type, retry_initial_delay_ms,
        timeout_ms, enabled, source, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `).run(
      id,
      '20-Second Test Task',
      'A test task that runs for 20 seconds with progress output',
      scriptPath,
      '[]',
      path.dirname(scriptPath),
      '{}',
      'manual',
      null,
      0,  // retry_enabled
      3,
      'exponential',
      1000,
      60000,  // 1 minute timeout
      1,      // enabled
      'config',
      now,
      now
    );

    console.log('Test task created successfully!');
    console.log('Task ID:', id);
  }

  db.close();
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
