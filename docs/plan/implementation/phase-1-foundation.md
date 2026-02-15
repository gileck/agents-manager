# Phase 1: Foundation

## Goal

Build a fully functional task manager with project support. No agent integration yet - just a solid task management app with a kanban board, list view, and CRUD operations.

By the end of this phase, users can:
- Create and manage projects (local codebases)
- Create/edit/delete tasks with rich metadata
- View tasks in a kanban board (by status) or list view
- Filter and sort tasks
- Manage task dependencies

**Architecture note:** This phase builds all abstraction interfaces (`../architecture/overview.md`) with simple SQLite implementations, and the pipeline engine (`../architecture/pipeline/engine.md`) with the "Simple" pipeline (`../architecture/pipeline/json-contract.md`). No hardcoded statuses anywhere - the kanban board, filters, and status dropdowns all read from the pipeline definition.

---

## Database Schema

### `projects` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Project name |
| path | TEXT | Absolute path to project directory |
| description | TEXT | Optional description |
| default_agent_type | TEXT | Default agent type (for Phase 2, default: 'claude-code') |
| created_at | TEXT (ISO) | Creation timestamp |
| updated_at | TEXT (ISO) | Last updated timestamp |

### `tasks` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| project_id | TEXT | FK → projects.id |
| title | TEXT | Task title |
| description | TEXT | Markdown description |
| status | TEXT | Current status ID (defined by pipeline, e.g., 'open', 'in_progress', 'done') |
| pipeline_id | TEXT | FK → pipelines.id (which pipeline this task uses, default: 'simple') |
| priority | TEXT | One of: critical, high, medium, low |
| size | TEXT | One of: xs, s, m, l, xl |
| complexity | TEXT | One of: simple, moderate, complex |
| tags | TEXT | JSON array of strings |
| branch_name | TEXT | Git branch name (nullable) |
| pr_url | TEXT | Pull request URL (nullable) |
| plan | TEXT | Implementation plan in markdown (nullable, populated in Phase 2) |
| parent_task_id | TEXT | FK → tasks.id for subtasks (nullable) |
| sort_order | INTEGER | Order within status column |
| created_at | TEXT (ISO) | Creation timestamp |
| updated_at | TEXT (ISO) | Last updated timestamp |

### `task_dependencies` table

| Column | Type | Description |
|--------|------|-------------|
| task_id | TEXT | FK → tasks.id (the blocked task) |
| depends_on_task_id | TEXT | FK → tasks.id (the blocking task) |

Primary key: (task_id, depends_on_task_id)

---

## IPC Channels

### Projects

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `projects:list` | renderer → main | - | Project[] |
| `projects:get` | renderer → main | { id } | Project |
| `projects:create` | renderer → main | { name, path, description? } | Project |
| `projects:update` | renderer → main | { id, ...fields } | Project |
| `projects:delete` | renderer → main | { id } | void |

### Tasks

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `tasks:list` | renderer → main | { projectId, filters? } | Task[] |
| `tasks:get` | renderer → main | { id } | Task (with dependencies) |
| `tasks:create` | renderer → main | { projectId, title, description, priority, size, complexity, tags?, parentTaskId? } | Task |
| `tasks:update` | renderer → main | { id, ...fields } | Task |
| `tasks:delete` | renderer → main | { id } | void |
| `tasks:reorder` | renderer → main | { id, status, sortOrder } | void |
| `tasks:add-dependency` | renderer → main | { taskId, dependsOnTaskId } | void |
| `tasks:remove-dependency` | renderer → main | { taskId, dependsOnTaskId } | void |

### Filters (for `tasks:list`)

```typescript
interface TaskFilters {
  status?: string[];
  priority?: string[];
  size?: string[];
  complexity?: string[];
  tags?: string[];
  search?: string; // searches title + description
}
```

---

## Types

```typescript
// src/shared/types.ts

// Status is a string, not an enum - it comes from the pipeline definition
type TaskStatus = string;
type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
type TaskSize = 'xs' | 's' | 'm' | 'l' | 'xl';
type TaskComplexity = 'simple' | 'moderate' | 'complex';

interface Project {
  id: string;
  name: string;
  path: string;
  description: string;
  defaultAgentType: string;
  createdAt: string;
  updatedAt: string;
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;      // dynamic - defined by pipeline
  pipelineId: string;       // which pipeline this task uses
  priority: TaskPriority;
  size: TaskSize;
  complexity: TaskComplexity;
  tags: string[];
  branchName: string | null;
  prUrl: string | null;
  plan: string | null;
  parentTaskId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  // Joined fields
  dependencies?: Task[];
  subtasks?: Task[];
}
```

---

## Pages & Components

### Projects Page (`/projects`)

**Purpose:** List all projects, add new ones, select active project.

**Components:**
- `ProjectList` - grid/list of project cards
- `ProjectCard` - shows name, path, task count summary
- `ProjectFormDialog` - modal for add/edit project (name, path picker, description)

**Behavior:**
- Clicking a project navigates to its board view
- "Add Project" button opens the form dialog
- Path field uses Electron's native directory picker dialog

---

### Task Board (`/projects/:id/board`)

**Purpose:** Kanban view of tasks grouped by status.

**Components:**
- `KanbanBoard` - horizontal scrollable board with status columns
- `KanbanColumn` - single status column with header (status name + count)
- `TaskCard` - compact card showing title, priority badge, size badge, complexity indicator, tags
- `TaskQuickAdd` - inline form at top of "Open" column to quickly add a task (just title + priority)

**Columns (left to right):**
Open | Planning | Planned | In Progress | Waiting for Review | PR Ready | Done

**Behavior:**
- Drag and drop cards between columns to change status
- Click card to navigate to task detail
- Right-click card for context menu (edit, delete, change priority)
- Column headers show task count
- Color-coded priority: critical=red, high=orange, medium=blue, low=gray

---

### Task List (`/projects/:id/tasks`)

**Purpose:** Table/list view of all tasks with filtering and sorting.

**Components:**
- `TaskTable` - sortable table with columns: title, status, priority, size, complexity, tags, updated
- `TaskFilters` - filter bar with dropdowns for status, priority, size, complexity, tags
- `SearchBar` - text search across title and description

**Behavior:**
- Click column headers to sort
- Click row to navigate to task detail
- Multi-select rows for future bulk operations (Phase 4)

---

### Task Detail (`/projects/:id/tasks/:taskId`)

**Purpose:** Full view of a single task with all metadata.

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ ← Back to Board          [Edit] [Delete]        │
├─────────────────────────────────────────────────┤
│ Task Title                          Status: Open │
│                                                  │
│ Priority: High  │  Size: M  │  Complexity: Mod   │
│ Tags: [auth] [backend]                           │
├─────────────────────────────────────────────────┤
│ Description (markdown rendered)                  │
│                                                  │
│ ...                                              │
├─────────────────────────────────────────────────┤
│ Plan (empty in Phase 1, placeholder)             │
├─────────────────────────────────────────────────┤
│ Dependencies                                     │
│ - Task #12: "Set up database schema" (done)     │
│ - Task #15: "Create API endpoints" (open)       │
├─────────────────────────────────────────────────┤
│ Subtasks                                         │
│ - Subtask #20: "Write unit tests" (open)        │
├─────────────────────────────────────────────────┤
│ Agent Runs (empty in Phase 1, placeholder)       │
└─────────────────────────────────────────────────┘
```

**Components:**
- `TaskDetailHeader` - title, status dropdown, action buttons
- `TaskMetadataBadges` - priority, size, complexity badges
- `MarkdownViewer` - renders description and plan
- `DependencyList` - list of dependencies with status
- `SubtaskList` - list of subtasks with status

---

### Task Form (`/projects/:id/tasks/new`, `/projects/:id/tasks/:taskId/edit`)

**Purpose:** Create or edit a task.

**Fields:**
- Title (text input, required)
- Description (markdown textarea with preview toggle)
- Status (dropdown)
- Priority (dropdown, default: medium)
- Size (dropdown, default: m)
- Complexity (dropdown, default: moderate)
- Tags (tag input - type and press enter to add)
- Branch name (text input, optional)
- Parent task (dropdown of existing tasks, optional)
- Dependencies (multi-select of existing tasks, optional)

---

### Settings (`/settings`)

**Purpose:** App-level preferences.

**Sections:**
- **Appearance:** Theme (dark/light/system)
- **Defaults:** Default priority, size, complexity for new tasks
- **Agent Defaults:** Default agent type, model (placeholder for Phase 2)

---

## Navigation / Layout

**Sidebar:**
```
┌──────────────────┐
│  Agents Manager   │
│                   │
│  [Project Picker] │
│                   │
│  📋 Board         │
│  📄 Tasks         │
│  🤖 Agents  (P2)  │
│  📊 Dashboard(P4) │
│                   │
│  ─────────────    │
│  ⚙️  Settings     │
│  📁 Projects      │
└──────────────────┘
```

- Project picker dropdown at top of sidebar
- Navigation items filter based on selected project
- "Agents" and "Dashboard" links shown but disabled until their phase

---

## Main Process Services

### `ProjectService`

```typescript
class ProjectService {
  list(): Promise<Project[]>
  getById(id: string): Promise<Project | null>
  create(data: CreateProjectInput): Promise<Project>
  update(id: string, data: UpdateProjectInput): Promise<Project>
  delete(id: string): Promise<void>
  validatePath(path: string): Promise<boolean> // check directory exists
}
```

### `TaskService`

```typescript
class TaskService {
  list(projectId: string, filters?: TaskFilters): Promise<Task[]>
  getById(id: string): Promise<Task> // includes dependencies and subtasks
  create(data: CreateTaskInput): Promise<Task>
  update(id: string, data: UpdateTaskInput): Promise<Task>
  delete(id: string): Promise<void>
  reorder(id: string, status: TaskStatus, sortOrder: number): Promise<void>
  addDependency(taskId: string, dependsOnTaskId: string): Promise<void>
  removeDependency(taskId: string, dependsOnTaskId: string): Promise<void>
}
```

---

## Migration (Phase 1)

```sql
-- Migration 001: Create pipelines table
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed default "Simple" pipeline
INSERT INTO pipelines (id, name, description, definition, is_default, created_at, updated_at)
VALUES ('simple', 'Simple', 'Basic task workflow', '{
  "id": "simple",
  "name": "Simple",
  "isDefault": true,
  "initialStatus": "open",
  "terminalStatuses": ["done", "cancelled"],
  "statuses": [
    { "id": "open", "label": "Open", "color": "#6b7280", "category": "backlog", "position": 0 },
    { "id": "in_progress", "label": "In Progress", "color": "#3b82f6", "category": "active", "position": 1 },
    { "id": "done", "label": "Done", "color": "#22c55e", "category": "done", "position": 2 },
    { "id": "cancelled", "label": "Cancelled", "color": "#9ca3af", "category": "done", "position": 3 }
  ],
  "transitions": [
    { "id": "t1", "from": "open", "to": "in_progress", "label": "Start", "trigger": { "type": "any" } },
    { "id": "t2", "from": "in_progress", "to": "done", "label": "Complete", "trigger": { "type": "any" } },
    { "id": "t3", "from": "in_progress", "to": "open", "label": "Send Back", "trigger": { "type": "any" } },
    { "id": "t4", "from": "*", "to": "cancelled", "label": "Cancel", "trigger": { "type": "manual" } }
  ]
}', 1, datetime('now'), datetime('now'));

-- Migration 002: Create transition_history table
CREATE TABLE IF NOT EXISTS transition_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  transition_id TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'user',
  agent_run_id TEXT,
  reason TEXT,
  guards_checked TEXT DEFAULT '[]',
  hooks_executed TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_transition_history_task ON transition_history(task_id);
CREATE INDEX idx_transition_history_created ON transition_history(created_at);

-- Migration 003: Create projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT DEFAULT '',
  default_agent_type TEXT DEFAULT 'claude-code',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Migration 004: Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_id TEXT NOT NULL DEFAULT 'simple',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  size TEXT NOT NULL DEFAULT 'm',
  complexity TEXT NOT NULL DEFAULT 'moderate',
  tags TEXT DEFAULT '[]',
  branch_name TEXT,
  pr_url TEXT,
  plan TEXT,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);

-- Migration 003: Create task_dependencies table
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);
```

---

## Deliverables Checklist

### Abstraction Layer
- [ ] All interfaces defined (`interfaces/` directory)
- [ ] ProviderRegistry + setup.ts wiring
- [ ] SqliteTaskStore (implements ITaskStore)
- [ ] SqliteProjectStore (implements IProjectStore)
- [ ] SqlitePipelineStore (implements IPipelineStore)
- [ ] SqliteStorage (implements IStorage)
- [ ] Stub implementations for Phase 2+ interfaces (IGitOps, IScmPlatform, INotifier, IActivityLog, IAgentFramework)

### Pipeline Engine
- [ ] IPipelineEngine interface
- [ ] PipelineEngine implementation (validate transitions, track history)
- [ ] "Simple" pipeline definition seeded in DB
- [ ] Transition history recording
- [ ] `getValidTransitions()` query (for dynamic UI buttons)
- [ ] All status changes go through pipeline engine (never direct update)

### Database
- [ ] Migrations: pipelines, transition_history, projects, tasks, task_dependencies

### Services + IPC
- [ ] ProjectService + IPC handlers (receives IProjectStore via constructor)
- [ ] TaskService + IPC handlers (receives ITaskStore via constructor)
- [ ] Pipeline IPC handlers (get pipeline, valid transitions, execute transition, history)

### UI
- [ ] Sidebar layout with project picker
- [ ] Projects page (list, create, edit, delete)
- [ ] Task Board page (kanban columns from pipeline definition, drag-and-drop triggers transitions)
- [ ] Task List page (table with filters and sort)
- [ ] Task Detail page (with transition buttons from `getValidTransitions()` + history timeline)
- [ ] Task Form page (create + edit)
- [ ] Settings page (theme, defaults)

### React Hooks
- [ ] `usePipeline(projectId)` - get pipeline definition
- [ ] `useValidTransitions(taskId)` - get available actions
- [ ] `useTransitionHistory(taskId)` - get status change history
- [ ] `useTransition()` - execute a status change
