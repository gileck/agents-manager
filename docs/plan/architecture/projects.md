# Projects

The top-level organizational unit in Agents Manager. A project represents a local codebase or git repository that the user manages tasks and runs agents against.

See also: [overview.md](overview.md) | [workflow-service.md](workflow-service.md) | [agent-platform.md](agent-platform.md)

---

## Overview

Every task, agent run, pipeline config, and worktree belongs to a project. Projects are how users scope their work -- each project maps to a directory on disk containing a git repository.

- A project has many **tasks** (one-to-many via `projectId`)
- A project has many **agent runs** (scoped for history and cost tracking)
- A project has its own **pipeline configuration** (which pipeline to use for new tasks)
- A project has its own **worktrees** (`<project-path>/.agent-worktrees/`)
- A project can have **project-level instructions** and **checks** (`.agents-manager/` directory)

Projects are relatively simple compared to Tasks or Pipeline -- they're primarily a container that ties everything else together.

---

## Data Model

```typescript
// src/main/interfaces/project-store.ts

interface Project {
  id: string;              // UUID
  name: string;            // display name
  path: string;            // absolute path to project directory
  description: string;
  config: ProjectConfig;   // parsed from .agents-manager/config.json (cached, re-read on change)
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

interface CreateProjectInput {
  name: string;
  path: string;
  description?: string;
}

interface UpdateProjectInput {
  name?: string;
  description?: string;
}
```

`path` is immutable after creation -- if the user moves their repo, they delete and re-add the project. This avoids cascading path updates across worktrees, agent run records, and file references.

---

## Project Store Interface (`IProjectStore`)

```typescript
// src/main/interfaces/project-store.ts

interface IProjectStore {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  getByPath(path: string): Promise<Project | null>;
  create(data: CreateProjectInput): Promise<Project>;
  update(id: string, data: UpdateProjectInput): Promise<Project>;
  delete(id: string): Promise<void>;
}
```

**Phase 1 implementation:** `SqliteProjectStore` -- reads/writes to local SQLite.
**Future:** Could sync with a remote service or read from a config file.

`getByPath()` exists specifically for CLI auto-detection -- when the user runs a CLI command from within a project directory, the CLI resolves the project by matching `cwd` against registered project paths.

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
```

The `UNIQUE` constraint on `path` enforces that no two projects point to the same directory. The index on `path` makes `getByPath()` lookups fast.

Agent configuration, pipeline assignment, checks, and all other per-project settings live in `.agents-manager/config.json` on disk — not in the database. The database stores only identity and metadata (name, path, description, timestamps). This keeps config version-controlled and shareable via git.

---

## Path Management

### Validation on Creation

When a user adds a project, the following checks run before the record is created:

```typescript
async function validateProjectPath(path: string, projectStore: IProjectStore): Promise<void> {
  // 1. Must be an absolute path
  if (!isAbsolute(path)) {
    throw new Error('Project path must be absolute');
  }

  // 2. Directory must exist
  const stats = await fs.stat(path);
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  // 3. Must be a git repository
  const gitDir = join(path, '.git');
  try {
    await fs.stat(gitDir);
  } catch {
    throw new Error('Directory is not a git repository');
  }

  // 4. No duplicate paths
  const existing = await projectStore.getByPath(path);
  if (existing) {
    throw new Error(`Project already registered at this path: ${existing.name}`);
  }
}
```

### Directory Picker

In the Electron app, project creation uses the native directory picker dialog:

```typescript
const { dialog } = require('electron');

const result = await dialog.showOpenDialog({
  properties: ['openDirectory'],
  title: 'Select Project Directory',
  message: 'Choose a git repository to add as a project',
});

if (!result.canceled && result.filePaths.length > 0) {
  const projectPath = result.filePaths[0];
  // Validate and create...
}
```

### CLI Auto-Detection

The CLI resolves the current project by walking up from `cwd` to find a registered project:

```typescript
async function resolveProjectFromCwd(
  cwd: string,
  projectStore: IProjectStore,
): Promise<Project | null> {
  // Check cwd and parent directories
  let dir = cwd;
  while (dir !== dirname(dir)) {
    const project = await projectStore.getByPath(dir);
    if (project) return project;
    dir = dirname(dir);
  }
  return null;
}
```

---

## Project-Level Configuration

All per-project configuration lives in the `.agents-manager/` directory at the project root. This directory is committed to the repo (shared across team members).

```
<project-path>/
├── .agents-manager/
│   ├── config.json        # All project configuration
│   └── instructions.md    # Free-form agent prompt instructions (markdown)
├── .agent-worktrees/      # Git worktrees for agents (gitignored, local-only)
│   ├── task-abc-123/
│   └── task-def-456/
└── ... (project source code)
```

### `config.json`

The single source of truth for all project settings. Every field is optional — omitted fields use global defaults.

```typescript
interface ProjectConfig {
  // --- Core ---
  defaultBranch?: string;       // base branch for agents (default: 'main')
  worktreesPath?: string;       // where worktrees are created (default: '.agent-worktrees/')

  // --- Agent defaults ---
  defaultAgentType?: string;    // 'claude-code' | 'cursor' | 'aider' | etc. (default: 'claude-code')
  agents?: {
    // Per-agent-type config overrides. Key is the agent type name.
    [agentType: string]: {
      model?: string;           // e.g. 'claude-sonnet-4-5-20250929'
      maxTurns?: number;        // max agentic turns before stopping
      timeout?: number;         // ms before killing the agent process
      temperature?: number;     // 0-1
      allowedTools?: string[];  // restrict which tools the agent can use
    };
  };
  autoRun?: {
    // Auto-start an agent when a task transitions to a certain status.
    // Key is the target status, value is the agent mode to run.
    [status: string]: 'plan' | 'implement';
    // Example: { "in_progress": "implement", "planning": "plan" }
  };

  // --- Checks ---
  checks?: {
    // Build/lint/test commands that run after agent completion.
    // All must pass for the agent run to be considered successful.
    build?: string;             // e.g. 'npm run build'
    lint?: string;              // e.g. 'npm run lint'
    test?: string;              // e.g. 'npm test'
    custom?: {
      [name: string]: string;   // e.g. { "typecheck": "npx tsc --noEmit" }
    };
  };

  // --- Pipeline ---
  pipeline?: string | object;   // Pipeline ID (string) or inline pipeline definition (object).
                                // Overrides the globally assigned pipeline for this project.

  // --- Git/SCM ---
  git?: {
    branchPrefix?: string;      // branch naming prefix (default: 'agents-manager/')
    prDraft?: boolean;          // create PRs as draft by default (default: false)
    prTemplate?: string;        // PR body template (supports {{task.title}}, {{task.description}}, etc.)
  };

  // --- Notifications ---
  notifications?: {
    // Which events trigger notifications for this project.
    // Each key is an event type, value is whether it's enabled.
    agentCompleted?: boolean;
    agentFailed?: boolean;
    prReady?: boolean;
    humanInputNeeded?: boolean;
  };
}
```

**Example `config.json`:**

```json
{
  "defaultBranch": "main",
  "worktreesPath": ".agent-worktrees/",
  "defaultAgentType": "claude-code",
  "agents": {
    "claude-code": {
      "model": "claude-sonnet-4-5-20250929",
      "maxTurns": 50,
      "timeout": 600000
    }
  },
  "autoRun": {
    "planning": "plan",
    "in_progress": "implement"
  },
  "checks": {
    "build": "npm run build",
    "lint": "npm run lint",
    "test": "npm test"
  },
  "git": {
    "branchPrefix": "agents-manager/",
    "prDraft": true
  },
  "notifications": {
    "agentCompleted": true,
    "agentFailed": true,
    "humanInputNeeded": true
  }
}
```

**Config resolution order** (later wins):

```
Global defaults → config.json → per-run overrides (from UI/CLI)
```

### `instructions.md`

Free-form markdown injected into every agent prompt for this project. Stays as a separate file because it's prose, not structured data. Teams use this for coding standards, architecture rules, testing requirements, and forbidden patterns. See [agent-platform.md](agent-platform.md) for how the `AgentContextBuilder` loads this.

### `.agent-worktrees/`

Gitignored, local-only. Managed by the worktree manager. Location is configurable via `config.json` → `worktreesPath`.

---

## Project-Task Relationship

Tasks are scoped to a project via `projectId`:

```typescript
// Creating a task always requires a projectId
const task = await workflowService.createTask({
  projectId: project.id,
  title: 'Add authentication middleware',
  description: '...',
});

// Listing tasks is always scoped to a project
const tasks = await workflowService.listTasks(project.id, { status: ['open'] });
```

- Tasks inherit the project's pipeline unless the project has a pipeline override
- The task board/list views in the UI are always scoped to the currently selected project
- Deleting a project cascade-deletes all its tasks from the database

---

## Project-Agent Relationship

- Agent runs are scoped to a project (via the task's `projectId`) for history and cost tracking
- Agent worktrees live under the path configured in `config.json` → `worktreesPath` (default: `<project-path>/.agent-worktrees/`)
- The project's `config.json` → `defaultAgentType` determines which agent runs by default when a user clicks "Run Agent" without specifying a type
- Agent config resolution follows the merge chain: global defaults → **`config.json` → `agents[type]`** → per-run overrides from UI/CLI (see [agent-platform.md](agent-platform.md) Step 3)
- `config.json` → `autoRun` can auto-start agents on status transitions (e.g., auto-plan when task enters "planning")

---

## Deletion Behavior

On project deletion:

```typescript
async deleteProject(projectId: string): Promise<void> {
  // 1. Stop any running agents for tasks in this project
  const runningAgents = await this.agentRunStore.listRunning(projectId);
  for (const run of runningAgents) {
    await this.stopAgent(run.id);
  }

  // 2. Cascade-delete from database
  //    - All tasks (and their notes, artifacts, dependencies)
  //    - All agent run records
  //    - All event log entries
  //    - Pipeline assignment
  //    - Agent config overrides
  await this.taskStore.deleteByProject(projectId);
  await this.agentRunStore.deleteByProject(projectId);
  await this.eventLog.deleteByProject(projectId);

  // 3. Delete the project record
  await this.projectStore.delete(projectId);

  // 4. The project directory is NOT touched
  //    .agent-worktrees/ and .agents-manager/ remain on disk
}
```

The project's directory, source code, `.agent-worktrees/`, and `.agents-manager/` are never modified or deleted. Only database records are removed.

---

## IPC Channels

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `projects:list` | renderer -> main | - | `Project[]` |
| `projects:get` | renderer -> main | `{ id }` | `Project` |
| `projects:create` | renderer -> main | `CreateProjectInput` | `Project` |
| `projects:update` | renderer -> main | `{ id, ...UpdateProjectInput }` | `Project` |
| `projects:delete` | renderer -> main | `{ id }` | `void` |

IPC handlers are thin wrappers around the Workflow Service:

```typescript
// src/main/ipc-handlers.ts

ipcMain.handle('projects:list', () =>
  workflowService.listProjects());

ipcMain.handle('projects:get', (_, { id }) =>
  workflowService.getProject(id));

ipcMain.handle('projects:create', (_, input) =>
  workflowService.createProject(input));

ipcMain.handle('projects:update', (_, { id, ...input }) =>
  workflowService.updateProject(id, input));

ipcMain.handle('projects:delete', (_, { id }) =>
  workflowService.deleteProject(id));
```

---

## Phase Rollout

### Phase 1
- `IProjectStore` interface + `SqliteProjectStore` implementation
- Project CRUD through IPC
- Path validation (exists, is git repo, no duplicates)
- Native directory picker for adding projects
- Project selector in sidebar
- Task list/board scoped to selected project
- `config.json` loading with defaults for missing fields
- `config.json` → `pipeline` support

### Phase 2
- `instructions.md` loaded into agent prompts by `AgentContextBuilder`
- `config.json` → `checks` for post-agent validation
- `config.json` → `defaultAgentType`, `agents` used by agent resolution
- `config.json` → `autoRun` for automatic agent triggers
- `config.json` → `git` settings used by worktree/PR creation
- Agent cost tracking scoped to project

### Phase 3
- CLI auto-detection via `getByPath()`
- `am config` CLI commands to read/edit `config.json`
- HTTP API for project CRUD

### Phase 4
- Project-level cost dashboard
- Activity feed filtered by project
- `config.json` → `notifications` for project-level notification preferences

### Phase 5
- GitHub issues import scoped to project
