# Phase 3: Agent CLI + Multi-Agent Support

## Goal

Enable agents to interact with the task system via a CLI tool, and support multiple agent types (Cursor CLI, Aider, custom commands) beyond Claude Code SDK.

By the end of this phase:
- A running agent can create/update/list tasks using a CLI command
- Users can choose between Claude Code SDK, Cursor CLI, Aider, or custom agents
- Each agent type has its own adapter with configuration

---

## Part A: Agent CLI

### Architecture

The Electron main process runs a **local HTTP server** (localhost only) that exposes the task API. A CLI tool (`agents-manager-cli` or `am`) communicates with this server.

```
┌──────────────┐     HTTP (localhost:PORT)     ┌──────────────────┐
│  CLI tool     │ ──────────────────────────→  │  Electron Main   │
│  (am tasks)   │ ←────────────────────────── │  HTTP Server     │
└──────────────┘                               │  (Express/Koa)   │
                                               │                  │
┌──────────────┐     stdio / SDK               │  AgentService    │
│  Running      │ ←──────────────────────────→ │                  │
│  Agent        │                               └──────────────────┘
└──────────────┘
```

### HTTP API Endpoints

Base URL: `http://localhost:{PORT}/api`

Port is dynamically assigned and stored in a well-known file:
`~/.agents-manager/server.json` → `{ "port": 52847, "pid": 12345 }`

#### Tasks API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks?projectId=X` | List tasks (with optional filters as query params) |
| GET | `/api/tasks/:id` | Get single task |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |
| POST | `/api/tasks/:id/notes` | Add a note/comment to a task |

#### Projects API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| GET | `/api/projects/:id` | Get single project |

#### Agent API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent/current` | Get current running agent info |
| POST | `/api/agent/report` | Agent reports its own progress |

### CLI Tool Design

Installed globally: `npm install -g agents-manager-cli`

Or bundled with the app and added to PATH.

```bash
# List tasks
am tasks list
am tasks list --status open --priority high

# Get task details
am tasks get <task-id>

# Create a task
am tasks create --title "Fix login bug" --priority high --size s --complexity simple
am tasks create --title "Add pagination" --description "Add pagination to the users list" --tags "frontend,ux"

# Update a task
am tasks update <task-id> --status in_progress
am tasks update <task-id> --status done --pr-url "https://github.com/..."

# Delete a task
am tasks delete <task-id>

# Add a note to a task
am tasks note <task-id> "Found the root cause - it's a race condition in the auth middleware"

# Get current project context (based on cwd)
am project info

# Quick status
am status
```

### Auto-Detection of Project

The CLI detects which project to target by:
1. Check `--project` flag
2. Check `AM_PROJECT_ID` env var (set by agent runner)
3. Match current working directory against known project paths
4. Error if no match

### Database Changes

Add `task_notes` table:

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| task_id | TEXT | FK → tasks.id |
| content | TEXT | Note content |
| author | TEXT | 'user' or agent type name |
| created_at | TEXT (ISO) | Timestamp |

---

## Part B: Multi-Agent Support

### Agent Type Abstraction

```typescript
interface AgentAdapter {
  type: string;                    // 'claude-code' | 'cursor' | 'aider' | 'custom'
  displayName: string;             // 'Claude Code SDK'

  // Check if the agent is available on this system
  isAvailable(): Promise<boolean>;

  // Run the agent
  run(options: AgentRunOptions): Promise<AgentRunResult>;

  // Stop a running agent
  stop(): void;

  // Get default config for this agent type
  getDefaultConfig(): AgentTypeConfig;
}

interface AgentRunOptions {
  projectPath: string;
  prompt: string;
  config: AgentTypeConfig;
  onMessage: (message: AgentMessage) => void;
  abortSignal: AbortSignal;
  env: Record<string, string>;  // includes AM_PROJECT_ID, AM_API_URL, etc.
}

interface AgentRunResult {
  transcript: AgentMessage[];
  tokenUsage?: TokenUsage;
  exitCode: number;
  outcome?: string;              // named outcome: "pr_ready", "plan_complete", "needs_info", etc. (only when exitCode === 0)
  payload?: TransitionPayload;   // structured output parsed by the adapter
  error?: string;                // error message when exitCode !== 0
}
```

### Supported Agent Types

#### 1. Claude Code SDK (existing from Phase 2)

```typescript
class ClaudeCodeAdapter implements AgentAdapter {
  type = 'claude-code';
  displayName = 'Claude Code SDK';

  async isAvailable(): Promise<boolean> {
    // Check if @anthropic-ai/claude-code is installed
    // Check if ANTHROPIC_API_KEY is set
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    // Use Claude Code SDK directly (as in Phase 2)
  }
}
```

Config: model, maxTurns, timeout, systemPrompt

#### 2. Cursor CLI

```typescript
class CursorAdapter implements AgentAdapter {
  type = 'cursor';
  displayName = 'Cursor CLI';

  async isAvailable(): Promise<boolean> {
    // Check if 'cursor' CLI is in PATH
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    // Spawn: cursor --cli --prompt "..." --cwd projectPath
    // Parse stdout for transcript
  }
}
```

Config: model (if applicable)

#### 3. Aider

```typescript
class AiderAdapter implements AgentAdapter {
  type = 'aider';
  displayName = 'Aider';

  async isAvailable(): Promise<boolean> {
    // Check if 'aider' is in PATH
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    // Spawn: aider --message "..." --yes-always --no-auto-commits
    // Parse stdout for transcript
  }
}
```

Config: model, editFormat (diff/whole/udiff)

#### 4. Custom Agent

```typescript
class CustomAdapter implements AgentAdapter {
  type = 'custom';
  displayName = 'Custom Agent';

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    // Spawn user-defined command with env vars:
    // AM_TASK_TITLE, AM_TASK_DESCRIPTION, AM_PROJECT_PATH, AM_API_URL, etc.
    // Parse stdout as transcript
  }
}
```

Config: command (string), args (string[]), shell (boolean)

### Agent Registry

```typescript
class AgentRegistry {
  private adapters: Map<string, AgentAdapter> = new Map();

  register(adapter: AgentAdapter): void
  get(type: string): AgentAdapter
  listAvailable(): AgentAdapter[]  // only returns agents that are installed
  listAll(): AgentAdapter[]
}
```

### Environment Variables Passed to Agents

Every agent process receives these env vars so it can use the CLI:

```
AM_API_URL=http://localhost:52847/api
AM_PROJECT_ID=<project-uuid>
AM_TASK_ID=<task-uuid>
AM_TASK_TITLE=<task-title>
AM_RUN_ID=<run-uuid>
```

---

## UI Changes

### Task Detail - Agent Picker

Before starting an agent, user picks the type:

```
┌────────────────────────────────────────────┐
│ Run Agent                                   │
│                                             │
│ Agent: [Claude Code SDK ▼]                  │
│ Mode:  [● Plan  ○ Implement]                │
│                                             │
│ [▶ Start]                                   │
└────────────────────────────────────────────┘
```

### Task Detail - Notes Section

New section showing notes/comments:

```
┌────────────────────────────────────────────┐
│ Notes                              [+ Add] │
│                                             │
│ 🤖 claude-code (2min ago)                   │
│ Found the root cause - race condition       │
│                                             │
│ 👤 user (5min ago)                          │
│ Check the auth middleware first              │
└────────────────────────────────────────────┘
```

### Settings - Agent Types

```
┌────────────────────────────────────────────┐
│ Agents                                      │
│                                             │
│ Claude Code SDK    ✅ Available    [Config]  │
│ Cursor CLI         ✅ Available    [Config]  │
│ Aider              ❌ Not found   [Install]  │
│ Custom             ─              [Setup]    │
│                                             │
│ Default Agent: [Claude Code SDK ▼]          │
└────────────────────────────────────────────┘
```

---

## Migration (Phase 3)

```sql
-- Migration 006: Create task_notes table
CREATE TABLE IF NOT EXISTS task_notes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_task_notes_task ON task_notes(task_id);

-- Migration 007: Add agent_type column to agent_runs (already exists but ensure extensibility)
-- No change needed - agent_type TEXT already supports any string
```

---

## Deliverables Checklist

- [ ] Local HTTP server in Electron main process
- [ ] Server port discovery file (~/.agents-manager/server.json)
- [ ] REST API endpoints (tasks CRUD, projects read, agent info)
- [ ] CLI tool (`am`) with all commands
- [ ] CLI auto-detection of project from cwd
- [ ] Task notes table + service + IPC + UI
- [ ] AgentAdapter interface
- [ ] CursorAdapter implementation
- [ ] AiderAdapter implementation
- [ ] CustomAdapter implementation
- [ ] AgentRegistry (discover available agents)
- [ ] Agent type picker in task detail UI
- [ ] Agent types settings page
- [ ] Pass environment variables to agent processes
- [ ] Update AgentService to use adapters
