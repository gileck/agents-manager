# Phase 3: CLI

**Goal:** Full CLI access — manage projects, tasks, agents, and pipelines from the terminal.

**Dependencies:** Phase 2

---

## What Gets Built

### Local HTTP Server
- Express server in Electron main process on `localhost` (dynamic port)
- Port file at `~/.agents-manager/server.json`
- Routes map 1:1 to WorkflowService methods
- JSON request/response

### CLI Tool (`am`)
- **Client mode** (default): HTTP calls to running Electron app
- **Standalone mode** (`--standalone`): Direct SQLite access (no Electron needed)
- Auto-detects mode: checks `~/.agents-manager/server.json` for running server

### CLI Commands

#### Project Management
```
am project list                    # List all projects
am project create <name> <path>    # Create project
am project show <id>               # Show project details
am project delete <id>             # Delete project
```

#### Task Management
```
am task list [--project <id>] [--status <s>] [--priority <p>]
am task create <title> [--project <id>] [--priority <p>] [--pipeline <id>]
am task show <id>                  # Full task details + events + artifacts
am task update <id> [--title <t>] [--priority <p>] [--description <d>]
am task delete <id>
am task transition <id> <status>   # Manual status transition
am task deps <id> [--add <dep>] [--remove <dep>]  # Manage dependencies
```

#### Agent Operations
```
am agent start <task-id> [--mode plan|implement] [--agent claude-code|cursor|custom]
am agent stop <task-id>            # Stop running agent
am agent status [<task-id>]        # Show agent status (all or specific)
am agent runs <task-id>            # List agent runs for task
am agent transcript <run-id>       # View agent run transcript
```

#### Pipeline Management
```
am pipeline list                   # List all pipelines
am pipeline show <id>              # Show pipeline with statuses and transitions
am pipeline transitions <task-id>  # Show valid transitions for a task
```

#### Notes & Artifacts
```
am note add <task-id> <text>       # Add note to task
am note list <task-id>             # List notes for task
am artifact list <task-id>         # List artifacts for task
```

#### Agent Queue
```
am queue add <task-id> [--mode plan|implement]  # Add task to queue
am queue list                      # Show queue
am queue pause                     # Pause queue processing
am queue resume                    # Resume queue processing
am queue clear                     # Clear queue
```

#### Overview
```
am status                          # Dashboard: active agents, task counts, recent activity
```

### Output Modes
- **Human-readable** (default): Formatted tables, colors, icons
- **JSON** (`--json`): Machine-readable output
- **Quiet** (`-q`): Minimal output (IDs only)

### Project Auto-Detection
- Walks up from `cwd` looking for `.agents-manager/config.json`
- If found, auto-sets `--project` for all commands
- Can override with explicit `--project <id>`

### Environment Variables for Agents
When an agent is started, these env vars are set in its process:
- `AM_API_URL` — HTTP server URL (for agent to call back)
- `AM_PROJECT_ID` — Current project ID
- `AM_TASK_ID` — Current task ID

### Additional Agent Adapters
- `CursorAgent` — Cursor editor agent adapter
- `CustomAgent` — Arbitrary CLI command as agent
- Agent registry with `isAvailable()` discovery

### Task Notes
- Agent and human comments on tasks
- Timestamped, attributed (user/agent/system)

---

## Database Tables (1)

### `task_notes`
```sql
CREATE TABLE task_notes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  author TEXT NOT NULL,        -- "user" | "agent" | "system"
  author_name TEXT,            -- display name
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE INDEX idx_task_notes_task_id ON task_notes(task_id);
```

---

## File Structure

```
src/main/
  server/
    index.ts                   # Express server setup, port file
    routes/
      project-routes.ts
      task-routes.ts
      agent-routes.ts
      pipeline-routes.ts
      note-routes.ts
      artifact-routes.ts
      queue-routes.ts
      status-routes.ts
  stores/
    sqlite-task-note-store.ts
  agents/
    cursor-agent.ts
    custom-agent.ts
    agent-registry.ts

cli/
  index.ts                     # Entry point, mode detection
  client.ts                    # HTTP client for Electron server
  commands/
    project.ts
    task.ts
    agent.ts
    pipeline.ts
    note.ts
    artifact.ts
    queue.ts
    status.ts
  output/
    formatter.ts               # Human-readable formatting
    json.ts                    # JSON output
  utils/
    project-detection.ts       # Auto-detect project from cwd

tests/
  cli/
    command-parsing.test.ts
    http-api.test.ts
    project-detection.test.ts
```

---

## User Can
Fully manage the system from terminal. Start agents, watch status, view transcripts, manage tasks — all via `am` CLI.
