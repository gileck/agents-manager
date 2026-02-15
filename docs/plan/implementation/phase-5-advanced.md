# Phase 5: Advanced Features

## Goal

Add power-user features: task templates, GitHub issues import, agent queue for sequential execution, and inline diff review. These are quality-of-life improvements for heavy users.

By the end of this phase:
- Users can create tasks from templates (bug fix, feature, refactor, etc.)
- Users can import tasks from GitHub issues
- Users can queue multiple tasks for sequential agent execution
- Users can review what an agent changed with an inline diff viewer

---

## Part A: Task Templates

### Concept

Pre-defined task templates that fill in default values when creating a task. Users can create custom templates.

### Database Schema

#### `task_templates` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Template name (e.g., "Bug Fix") |
| description_template | TEXT | Markdown template with placeholders |
| default_priority | TEXT | Default priority |
| default_size | TEXT | Default size |
| default_complexity | TEXT | Default complexity |
| default_tags | TEXT | JSON array of default tags |
| is_builtin | INTEGER | 1 for built-in templates, 0 for user-created |
| created_at | TEXT (ISO) | Timestamp |
| updated_at | TEXT (ISO) | Timestamp |

### Built-in Templates

**Bug Fix:**
```markdown
## Bug Description
[Describe the bug]

## Steps to Reproduce
1.
2.
3.

## Expected Behavior
[What should happen]

## Actual Behavior
[What happens instead]

## Possible Cause
[Any ideas on root cause]
```
Priority: high, Size: s, Complexity: simple, Tags: [bug]

**Feature:**
```markdown
## Overview
[What is this feature]

## User Story
As a [user type], I want [goal] so that [benefit].

## Requirements
- [ ]
- [ ]
- [ ]

## Design Notes
[Any design considerations]

## Acceptance Criteria
- [ ]
- [ ]
```
Priority: medium, Size: m, Complexity: moderate, Tags: [feature]

**Refactor:**
```markdown
## What to Refactor
[Which code/module]

## Current Problems
[Why it needs refactoring]

## Proposed Approach
[How to refactor]

## Files Affected
-

## Risks
[Breaking changes, regressions, etc.]
```
Priority: medium, Size: m, Complexity: moderate, Tags: [refactor]

**Tech Debt:**
```markdown
## Issue
[What is the tech debt]

## Impact
[How it affects development]

## Proposed Fix
[How to address it]

## Effort
[Rough estimate of effort involved]
```
Priority: low, Size: s, Complexity: simple, Tags: [tech-debt]

### UI

**Task creation - template picker:**
```
┌───────────────────────────────────────┐
│ New Task                               │
│                                        │
│ Template: [None ▼]                     │
│           ├ None (blank)               │
│           ├ Bug Fix                    │
│           ├ Feature                    │
│           ├ Refactor                   │
│           ├ Tech Debt                  │
│           └ + Create Template...       │
│                                        │
│ (rest of form pre-filled by template)  │
└───────────────────────────────────────┘
```

**Template manager (in Settings):**
- List all templates (built-in + custom)
- Create/edit/delete custom templates
- Cannot delete built-in templates but can modify them (creates an override)

---

## Part B: GitHub Issues Import

### Concept

Import tasks from a GitHub repository's issues. One-way sync (import only, not continuous sync).

### Implementation

Use the `gh` CLI or GitHub REST API (via fetch) to list issues.

```typescript
class GitHubImportService {
  async listIssues(repoUrl: string, filters?: {
    state?: 'open' | 'closed' | 'all';
    labels?: string[];
    limit?: number;
  }): Promise<GitHubIssue[]>

  async importIssues(projectId: string, issues: GitHubIssue[], options?: {
    defaultPriority?: TaskPriority;
    defaultSize?: TaskSize;
    mapLabels?: boolean;  // map GitHub labels to tags
  }): Promise<Task[]>
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  url: string;
  createdAt: string;
}
```

### Label → Priority Mapping

| GitHub Label | Priority |
|-------------|----------|
| bug, critical | critical |
| high-priority, urgent | high |
| enhancement, feature | medium |
| good-first-issue, low-priority | low |

### UI

**Import dialog (accessible from task list):**
```
┌───────────────────────────────────────────────┐
│ Import from GitHub                             │
│                                                │
│ Repository: [owner/repo        ]  [Fetch]      │
│                                                │
│ Filter: [● Open  ○ Closed  ○ All]              │
│ Labels: [bug, feature          ]               │
│                                                │
│ Found 15 issues:                               │
│ ☑ #42 - Fix login redirect          bug        │
│ ☑ #41 - Add dark mode               feature    │
│ ☐ #40 - Update dependencies         chore      │
│ ☑ #39 - Mobile responsive header    feature    │
│ ...                                            │
│                                                │
│ [Import 3 Selected]                            │
└───────────────────────────────────────────────┘
```

### Linking

Imported tasks store the GitHub issue URL in a new field:
- Add `source_url` column to tasks table
- Display as a clickable link on task detail

---

## Part C: Agent Queue

### Concept

Queue multiple tasks for sequential agent execution. The agent finishes one task, then automatically starts the next.

### Database Schema

#### `agent_queue` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| project_id | TEXT | FK → projects.id |
| task_id | TEXT | FK → tasks.id |
| agent_type | TEXT | Which agent to use |
| mode | TEXT | 'plan' or 'implement' |
| position | INTEGER | Order in queue |
| status | TEXT | 'queued', 'running', 'completed', 'failed', 'skipped' |
| created_at | TEXT (ISO) | Timestamp |

### Queue Service

```typescript
class AgentQueueService {
  add(items: { taskId: string; agentType: string; mode: AgentRunMode }[]): void
  remove(queueId: string): void
  reorder(queueId: string, newPosition: number): void
  getQueue(projectId: string): QueueItem[]

  // Called automatically when an agent run completes
  processNext(projectId: string): void

  // Pause/resume the queue
  pause(projectId: string): void
  resume(projectId: string): void

  clear(projectId: string): void
}
```

### Behavior

1. User selects multiple tasks (from board or list) and clicks "Queue for Agent"
2. Tasks are added to the queue with chosen agent type and mode
3. First task starts immediately
4. When it completes (success or failure), the next one starts
5. Failed tasks can be retried or skipped
6. User can pause/resume/clear the queue
7. Queue status shown on dashboard

### UI

**Queue panel (sidebar or bottom panel):**
```
┌─────────────────────────────────────────┐
│ Agent Queue (3 tasks)     [⏸ Pause] [✕] │
├─────────────────────────────────────────┤
│ 🟢 1. "Add auth" - implement - running  │
│ ⏳ 2. "Fix CSS" - implement - queued    │
│ ⏳ 3. "Add tests" - plan - queued       │
│                                          │
│ [+ Add Tasks]                            │
└─────────────────────────────────────────┘
```

---

## Part D: Diff Review

### Concept

After an agent completes an implementation, show a diff of what changed so the user can review before merging/approving.

### Implementation

Use `git diff` to get the changes made by the agent on its branch.

```typescript
class DiffService {
  // Get diff for a specific agent run
  async getDiff(agentRun: AgentRun): Promise<FileDiff[]>

  // Get diff between two branches
  async getBranchDiff(projectPath: string, baseBranch: string, headBranch: string): Promise<FileDiff[]>
}

interface FileDiff {
  filePath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}
```

### Git Integration

```bash
# Get diff for agent's branch vs base
git diff main...agent/task-123 --stat
git diff main...agent/task-123

# Get list of changed files
git diff main...agent/task-123 --name-status
```

Parse the git diff output into structured `FileDiff` objects.

### UI

**Diff viewer on agent run detail page:**
```
┌─────────────────────────────────────────────────┐
│ Changes (3 files, +45 -12)            [Approve] │
├─────────────────────────────────────────────────┤
│ 📄 src/pages/Login.tsx           +30 -0 (new)   │
│ 📄 src/api/auth.ts               +10 -5         │
│ 📄 src/router.tsx                 +5  -7         │
├─────────────────────────────────────────────────┤
│ ── src/api/auth.ts ──────────────────────────── │
│                                                  │
│  10   import { db } from '../db';                │
│  11 - export function login(email, password) {   │
│  11 + export async function login(               │
│  12 +   email: string,                           │
│  13 +   password: string                         │
│  14 + ): Promise<User> {                         │
│  15     const user = db.findUser(email);          │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Components:**
- `DiffViewer` - container for all file diffs
- `FileDiffHeader` - file path, stats, expand/collapse
- `DiffHunkView` - renders a single hunk with line numbers
- `DiffLine` - single line with add/delete/context styling

**Styling:**
- Added lines: green background
- Deleted lines: red background
- Context lines: neutral background
- Line numbers in gutter
- File headers with expand/collapse

---

## Migration (Phase 5)

```sql
-- Migration 009: Create task_templates table
CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description_template TEXT DEFAULT '',
  default_priority TEXT DEFAULT 'medium',
  default_size TEXT DEFAULT 'm',
  default_complexity TEXT DEFAULT 'moderate',
  default_tags TEXT DEFAULT '[]',
  is_builtin INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Migration 010: Add source_url to tasks
ALTER TABLE tasks ADD COLUMN source_url TEXT;

-- Migration 011: Create agent_queue table
CREATE TABLE IF NOT EXISTS agent_queue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_queue_project ON agent_queue(project_id);
CREATE INDEX idx_queue_position ON agent_queue(position);

-- Seed built-in templates
INSERT INTO task_templates (id, name, description_template, default_priority, default_size, default_complexity, default_tags, is_builtin, created_at, updated_at)
VALUES
  ('tpl-bug', 'Bug Fix', '...', 'high', 's', 'simple', '["bug"]', 1, datetime('now'), datetime('now')),
  ('tpl-feature', 'Feature', '...', 'medium', 'm', 'moderate', '["feature"]', 1, datetime('now'), datetime('now')),
  ('tpl-refactor', 'Refactor', '...', 'medium', 'm', 'moderate', '["refactor"]', 1, datetime('now'), datetime('now')),
  ('tpl-tech-debt', 'Tech Debt', '...', 'low', 's', 'simple', '["tech-debt"]', 1, datetime('now'), datetime('now'));
```

---

## Deliverables Checklist

- [ ] Task templates table + service
- [ ] Built-in templates (bug, feature, refactor, tech debt)
- [ ] Template picker in task creation form
- [ ] Template manager in settings
- [ ] GitHubImportService (fetch issues via gh CLI or API)
- [ ] Import dialog UI with issue selection
- [ ] Label → priority/tag mapping
- [ ] source_url field on tasks
- [ ] Agent queue table + service
- [ ] Queue processing logic (auto-start next task)
- [ ] Queue UI panel
- [ ] Bulk "Queue for Agent" action
- [ ] Pause/resume/clear queue
- [ ] DiffService (parse git diff output)
- [ ] DiffViewer component (file list + inline diff)
- [ ] Diff tab on agent run detail page
- [ ] Diff summary on task detail page
