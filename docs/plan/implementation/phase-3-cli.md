# Phase 3: CLI

**Goal:** Full CLI access — manage projects, tasks, agents, and pipelines from the terminal.

**Dependencies:** Phase 2

---

## What Gets Built

### CLI Tool (`am`) — Direct DB Access

The CLI instantiates `WorkflowService` directly using `createAppServices(db)` — the same composition root as the Electron app. No HTTP server, no port files, no Express. The CLI and Electron app both talk to the same SQLite database via WAL mode.

```
CLI (am) ──→ createAppServices(db) ──→ WorkflowService ──→ SQLite
Electron  ──→ IPC ──→ WorkflowService ──→ SQLite (same file)
```

### CLI Commands

#### Project Management
```
am projects list                   # List all projects
am projects create --name <n> --path <p>  # Create project
am projects get <id>               # Show project details
am projects delete <id>            # Delete project
```

#### Task Management
```
am tasks list [--project <id>] [--status <s>] [--priority <p>]
am tasks create --title <t> [--project <id>] [--priority <p>] [--pipeline <id>]
am tasks get <id>                  # Full task details + events + artifacts
am tasks update <id> [--title <t>] [--priority <p>] [--description <d>]
am tasks delete <id>
am tasks transition <id> <status>  # Manual status transition
am deps add <task-id> <dep-id>     # Add dependency
am deps remove <task-id> <dep-id>  # Remove dependency
```

#### Agent Operations
```
am agent start <task-id> [--mode plan|implement] [--agent claude-code|cursor|custom]
am agent stop <task-id>            # Stop running agent
am agent runs [--task <id>]        # List agent runs
am agent get <run-id>              # Show agent run details
am agent watch <run-id>            # Poll-based live output (like tail -f)
am agent transcript <run-id>       # View agent run transcript
am agent types                     # List available agent types
am agent cost [--task <id>]        # Cost summary
```

#### Pipeline Management
```
am pipelines list                  # List all pipelines
am pipelines get <id>              # Show pipeline details
am pipelines graph <id>            # ASCII visualization
am tasks transitions <task-id>     # Show valid transitions for a task
```

#### Notes & Artifacts
```
am notes add <task-id> <text>      # Add note to task
am notes list <task-id>            # List notes for task
am artifacts list <task-id>        # List artifacts for task
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
am stats [--since <date>]          # Detailed cost/performance stats
```

### Output Modes
- **Human-readable** (default): Formatted tables, colors, icons
- **JSON** (`--json`): Machine-readable output
- **Quiet** (`-q`): Minimal output (IDs only)
- **Verbose** (`--verbose`): Full details, no truncation

### Project Auto-Detection
- Walks up from `cwd` to find a directory matching a known project path in the database
- Can override with explicit `--project <id>` or `AM_PROJECT_ID` env var

### Environment Variables for Agents
When an agent is started, these env vars are set in its process:
- `AM_PROJECT_ID` — Current project ID
- `AM_TASK_ID` — Current task ID
- `AM_DB_PATH` — Database path (so agent can use CLI to query/update)

Agents interact with the system via CLI commands (e.g., `am notes add $AM_TASK_ID "found the bug"`). No HTTP callback URL needed.

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
src/
  cli/
    index.ts                     # Entry point, commander setup
    db.ts                        # Database init (opens SQLite, calls createAppServices)
    commands/
      projects.ts
      tasks.ts
      agent.ts
      pipelines.ts
      notes.ts
      artifacts.ts
      queue.ts
      status.ts
      deps.ts
      prompts.ts
      events.ts
      settings.ts
    output/
      formatter.ts               # Output mode routing (json/table/quiet)
      table.ts                   # Human-readable table formatting
      colors.ts                  # Color/symbol utilities
    utils/
      project-detect.ts          # Auto-detect project from cwd
      interactive.ts             # Interactive prompts (inquirer)

  main/
    stores/
      sqlite-task-note-store.ts
    agents/
      cursor-agent.ts
      custom-agent.ts
      agent-registry.ts

tests/
  cli/
    command-parsing.test.ts
    project-detection.test.ts
    cli-integration.test.ts      # End-to-end CLI → DB tests (in-memory SQLite)
```

---

## User Can
Fully manage the system from terminal. Start agents, watch status, view transcripts, manage tasks — all via `am` CLI. Works independently of the Electron app.
