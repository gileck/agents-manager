# Workflow CLI

The CLI is a full-featured interface to the Agents Manager — every operation available in the Electron app UI is available as a CLI command. The CLI is a **first-class citizen**, not an afterthought.

See also: [workflow-service.md](workflow-service.md) | [overview.md](overview.md) | [agent-platform.md](agent-platform.md) | [pipeline/index.md](pipeline/index.md)

---

## Why CLI-First

### The CLI as the Foundation Layer

The CLI is the fastest way to build, test, and iterate on the core logic:

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1-2: Build with CLI only                              │
│                                                              │
│  CLI ──→ createAppServices(db) ──→ WorkflowService ──→ SQLite│
│                                                              │
│  Every feature is built, tested, and validated via CLI        │
│  before any UI code is written.                              │
├─────────────────────────────────────────────────────────────┤
│  Phase 2-3: Layer UI on top                                  │
│                                                              │
│  Electron UI ──→ IPC ──→ WorkflowService ──→ SQLite          │
│  CLI ──→ createAppServices(db) ──→ WorkflowService ──→ SQLite│
│                                                              │
│  Both UIs call the same WorkflowService. Both produce        │
│  identical behavior. No HTTP server needed.                  │
└─────────────────────────────────────────────────────────────┘
```

### Benefits of CLI-First

1. **Faster iteration** — test a new feature in seconds, no UI to build/rebuild
2. **Scriptable** — pipe commands, automate workflows, integrate with CI/CD
3. **Testable** — CLI commands are easy to test in automated scripts
4. **Debuggable** — see exactly what's happening with `--verbose` and `--json`
5. **Agent-accessible** — running agents can use the CLI to query/update tasks
6. **Remote-friendly** — SSH into a machine and manage agents from terminal
7. **UI-independent** — works with or without the Electron app running

### Development Strategy

```
1. Define IWorkflowService interface
2. Implement WorkflowService (business logic)
3. Build CLI tool (thin commands → WorkflowService via createAppServices)
4. Test everything via CLI
5. Build Electron IPC layer (thin handlers → WorkflowService)
6. Build React UI (calls IPC)
```

Steps 1-4 don't need Electron at all. The entire feature set can be developed and validated before any UI code exists.

---

## Architecture

### Direct DB Access (No HTTP Server)

The CLI instantiates `WorkflowService` directly using the same `createAppServices(db)` composition root as the Electron app. Both the CLI and the Electron app talk to the same SQLite database.

```
┌──────────┐     direct              ┌──────────────────┐
│  CLI      │ ─────────────────────→ │  WorkflowService │
│  (am)     │ ←──────────────────── │  ↓               │
└──────────┘                         │  SQLite          │
                                     └──────────────────┘

┌──────────┐     IPC                 ┌──────────────────┐
│ Electron  │ ─────────────────────→ │  WorkflowService │
│ Renderer  │ ←──────────────────── │  ↓               │
└──────────┘                         │  SQLite          │
                                     └──────────────────┘
```

Both use the same `createAppServices(db)` → same WorkflowService → same SQLite file. The CLI is a standalone Node.js process — it does not need the Electron app to be running.

### Why No HTTP Server

The original architecture called for an HTTP server in the Electron main process, with the CLI as an HTTP client. We chose direct DB access instead. Here's the analysis:

#### What we lose

| Capability | HTTP approach | Direct DB approach | Impact |
|---|---|---|---|
| Real-time streaming | SSE from HTTP server | Not available from CLI | **Low** — `am agent watch` can poll the DB or use file-based tailing instead |
| Live UI sync | CLI changes push to Electron via SSE | Electron must poll or use fs.watch on the DB | **Low** — Electron can use SQLite's WAL mode change detection or a short poll interval |
| Agent callback URL | Agent gets `AM_API_URL` env var | Agent uses CLI commands or direct DB | **None** — agents already run CLI commands; no HTTP needed |
| Single process coordination | All mutations go through one process | Two processes can write to SQLite | **None** — SQLite handles concurrent writers with WAL mode; single-writer lock prevents corruption |

#### What we gain

| Benefit | Details |
|---|---|
| **No Express dependency** | Eliminates express, route definitions, error middleware, port management, CORS |
| **No port discovery** | No `~/.agents-manager/server.json`, no PID checking, no port conflicts |
| **No connection failures** | CLI never fails with "app not running" — it always works |
| **Simpler testing** | Test CLI commands with an in-memory SQLite DB, no HTTP mocking |
| **Fewer moving parts** | One less process boundary, one less serialization layer, one less failure mode |
| **Faster startup** | CLI starts instantly — no HTTP handshake or health check |

#### Mitigations for lost capabilities

**Real-time agent output (`am agent watch`):** Instead of SSE streaming, the CLI can:
1. Poll the `agent_runs` table + `task_events` table on a short interval (500ms)
2. Tail the agent's log file directly (agents write output to a file)
3. This is actually simpler than maintaining an SSE connection

**Electron UI live updates when CLI makes changes:** Two options:
1. **Poll on focus** — when the Electron window gains focus, refresh data from SQLite (simplest, good enough for v1)
2. **fs.watch on the SQLite WAL file** — detect when another process writes, then refresh. Low overhead, near-instant.
3. **Add HTTP/IPC later if needed** — if real-time cross-process sync becomes critical, we can add it as a targeted feature, not as the CLI's entire transport layer

**Agent integration:** Agents already run as child processes. They can:
1. Use CLI commands: `am notes add $AM_TASK_ID "Found the bug"`
2. Read task context: `am tasks get $AM_TASK_ID --json`
3. No HTTP callback needed — the CLI handles everything

### Decision

Direct DB access is the right default. The HTTP server adds significant complexity to solve problems we don't have yet. If real-time cross-process coordination becomes essential, it can be added as a targeted feature later — but it should not be the CLI's primary transport.

---

## CLI Tool (`am`)

### Installation

```bash
# Option 1: Bundled with the Electron app (added to PATH on install)
# The app registers `am` in /usr/local/bin on first launch

# Option 2: npm global install
npm install -g @agents-manager/cli

# Option 3: npx (no install)
npx @agents-manager/cli tasks list
```

### Global Flags

```
--project <id>       Override project (default: auto-detect from cwd)
--json               Output as JSON (for scripting)
--verbose            Show full details (no truncation)
--quiet              Suppress non-essential output
--no-color           Disable colored output
--db <path>          Override database path (default: ~/Library/Application Support/agents-manager/agents-manager.db)
```

### Project Auto-Detection

When `--project` is not specified, the CLI detects the project:

1. Check `AM_PROJECT_ID` env var (set by agent runner)
2. Walk up from `cwd` to find a directory matching a known project path
3. If no match, error with list of known projects

```bash
# Working in /Users/me/code/my-app (registered as project "my-app")
cd /Users/me/code/my-app
am tasks list                     # auto-detects "my-app" project
am tasks list --project proj-123  # explicit override
```

---

## Command Reference

### Projects

```bash
# List all projects
am projects list
am projects ls                    # alias

# Get project details
am projects get <project-id>
am projects info                  # get project for current directory

# Create a new project
am projects create --name "My App" --path /Users/me/code/my-app
am projects create --name "My App" --path . --description "A cool app"

# Update a project
am projects update <project-id> --name "New Name"
am projects update <project-id> --description "Updated description"
am projects update <project-id> --default-agent claude-code

# Delete a project
am projects delete <project-id>
am projects delete <project-id> --confirm   # skip confirmation prompt
```

**Output example (`am projects list`):**

```
  ID          NAME        PATH                          TASKS
  proj-abc    My App      /Users/me/code/my-app         12 (3 open, 2 active)
  proj-def    Backend     /Users/me/code/backend        8 (5 open, 1 active)
```

---

### Tasks

#### CRUD

```bash
# List tasks
am tasks list                                         # all tasks in current project
am tasks list --status open,planned                   # filter by status
am tasks list --priority high,critical                # filter by priority
am tasks list --size s,m                              # filter by size
am tasks list --complexity simple                     # filter by complexity
am tasks list --tags "auth,backend"                   # filter by tags
am tasks list --search "login"                        # search title + description
am tasks list --status open --priority high --json    # combine filters + JSON output
am tasks ls                                           # alias

# Get task details
am tasks get <task-id>
am tasks show <task-id>                               # alias
am tasks get <task-id> --json                         # full JSON for scripting

# Create a task
am tasks create --title "Fix login bug"
am tasks create --title "Add pagination" \
  --description "Add pagination to the users list API endpoint" \
  --priority high \
  --size m \
  --complexity moderate \
  --tags "frontend,ux"
am tasks create --title "Write tests" --parent <parent-task-id>

# Create task interactively (prompts for each field)
am tasks create -i

# Create task from file (reads markdown with frontmatter)
am tasks create --from-file task.md

# Update a task
am tasks update <task-id> --title "Updated title"
am tasks update <task-id> --priority critical --size l
am tasks update <task-id> --tags "auth,security,backend"
am tasks update <task-id> --description "New description"

# Delete a task
am tasks delete <task-id>
am tasks delete <task-id> --confirm                   # skip prompt

# Bulk operations
am tasks bulk-update --status open --set-priority medium    # update all open → medium priority
am tasks bulk-delete --status cancelled --confirm           # delete all cancelled tasks
```

**Output example (`am tasks list`):**

```
  STATUS        PRIORITY   SIZE   TITLE                           ID
  ● Open        high       m      Fix login bug                   task-abc
  ● Open        medium     s      Add pagination                  task-def
  ◐ In Progress high       l      Implement auth middleware        task-ghi
  ◐ In Progress medium     m      Refactor database queries        task-jkl
  ✓ Done        high       m      Set up CI pipeline              task-mno
```

**Output example (`am tasks get task-abc`):**

```
  Fix login bug
  ─────────────────────────────────────────────
  ID:          task-abc-1234
  Status:      Open
  Priority:    high
  Size:        m
  Complexity:  moderate
  Tags:        auth, backend
  Pipeline:    Standard
  Branch:      (none)
  PR:          (none)
  Created:     Feb 10, 2026 10:00am
  Updated:     Feb 12, 2026 3:30pm

  Description:
    Users report intermittent 401 errors when
    logging in. Happens ~10% of the time.

  Plan:
    (none)

  Dependencies:
    - task-xyz "Set up database schema" (done ✓)

  Artifacts:
    (none)

  Valid transitions:
    → Plan        (am tasks transition task-abc planning)
    → Start       (am tasks transition task-abc in_progress)
    → Cancel      (am tasks transition task-abc cancelled)
```

#### Task File Format

For `--from-file`, tasks can be defined in markdown with YAML frontmatter:

```markdown
---
title: Add user authentication
priority: high
size: l
complexity: complex
tags: [auth, security, backend]
---

## Description

Implement JWT-based authentication for the API.

### Requirements
- Login endpoint with email/password
- Token refresh endpoint
- Middleware for protected routes
- Password hashing with bcrypt
```

---

### Pipeline / Transitions

```bash
# Show valid transitions for a task (what can I do next?)
am tasks transitions <task-id>
am tasks next <task-id>                               # alias

# Execute a transition (move task to new status)
am tasks transition <task-id> <target-status>
am tasks transition <task-id> <target-status> --reason "Ready for review"
am tasks move <task-id> <target-status>               # alias

# View transition history
am tasks history <task-id>
am tasks history <task-id> --limit 20
am tasks history <task-id> --json

# Quick shortcuts for common transitions
am tasks start <task-id>                              # → first "active" status
am tasks done <task-id>                               # → first "done" status
am tasks cancel <task-id>                             # → "cancelled"
am tasks plan <task-id>                               # → "planning" (triggers plan agent)
am tasks implement <task-id>                          # → "in_progress" (triggers implement agent)
```

**Output example (`am tasks transitions task-abc`):**

```
  Task: Fix login bug (Open)

  Available transitions:
    → planning        Plan           (triggers: start_agent[plan])
    → in_progress     Start          (skip planning, go directly to implementation)
    → cancelled       Cancel

  Usage: am tasks transition task-abc <target-status>
```

**Output example (`am tasks history task-abc`):**

```
  Task: Fix login bug

  ● Feb 10, 10:00am   Created (Open)
  │
  ● Feb 10, 10:01am   Open → Planning          user: "Start planning"
  │                    Hook: start_agent (plan mode)
  │
  ● Feb 10, 10:02am   Planning → Planned        agent: plan_complete
  │                    Agent: claude-code (45s, $0.02)
  │
  ● Feb 10, 10:03am   Planned → In Progress     user: "Implement"
  │                    Hook: start_agent (implement mode)
  │
  ★ Feb 10, 10:06am   In Progress (current)
                       Agent: claude-code (running, 3m12s)
```

---

### Agents

```bash
# Start an agent on a task
am agent start <task-id>                              # default mode (inferred from pipeline)
am agent start <task-id> --mode plan                  # explicit mode
am agent start <task-id> --mode implement
am agent start <task-id> --mode review
am agent start <task-id> --mode investigate
am agent start <task-id> --agent cursor               # use specific agent type
am agent start <task-id> --model claude-opus-4-6      # override model

# Stop a running agent
am agent stop <run-id>
am agent stop --task <task-id>                        # stop agent running on this task

# List agent runs
am agent runs                                         # all runs in current project
am agent runs --task <task-id>                        # runs for specific task
am agent runs --status running                        # only running agents
am agent runs --status failed                         # only failed runs
am agent runs --limit 20

# Get agent run details
am agent get <run-id>
am agent show <run-id>                                # alias

# Watch agent output (polls DB for updates, like tail -f)
am agent watch <run-id>
am agent watch --task <task-id>                       # watch agent on this task
am agent logs <run-id>                                # alias (shows completed output)

# View agent transcript
am agent transcript <run-id>
am agent transcript <run-id> --full                   # include tool_use details

# List available agent types
am agent types
am agent types --check                                # check which are installed

# Agent cost summary
am agent cost                                         # total cost for current project
am agent cost --task <task-id>                        # cost for specific task
am agent cost --since "2026-02-01"                    # cost since date
```

**Output example (`am agent runs`):**

```
  RUN ID       TASK                        AGENT        MODE       STATUS      DURATION   COST
  run-abc      Fix login bug               claude-code  implement  ● running   3m12s      $0.08
  run-def      Add pagination              claude-code  plan       ✓ completed 45s        $0.02
  run-ghi      Refactor queries            cursor       implement  ✗ failed    1m30s      -
```

**Output example (`am agent watch run-abc`):**

```
  Agent: claude-code (implement mode)
  Task: Fix login bug
  Status: running (3m12s)
  ─────────────────────────────────────────────

  [3:12:05] Reading src/auth/middleware.ts
  [3:12:08] I see the issue. The JWT verification is using a
            synchronous call that sometimes throws before the
            token is fully parsed...
  [3:12:15] Editing src/auth/middleware.ts
  [3:12:18] Writing tests for the fix...
  [3:12:25] Writing src/auth/__tests__/middleware.test.ts
  █ (polling for updates...)

  Ctrl+C to stop watching (agent keeps running)
```

---

### Prompts & Responses

When an agent needs human input (needs_info, options, changes_requested), the CLI can display and respond to these prompts.

```bash
# List pending prompts (across all tasks or specific task)
am prompts list
am prompts list --task <task-id>
am prompts pending                                    # alias

# View prompt details
am prompts get <prompt-id>
am prompts show <prompt-id>                           # alias

# Respond to a prompt
am prompts respond <prompt-id> --action <action-id>
am prompts respond <prompt-id> --action approve
am prompts respond <prompt-id> --action provide_info --answer "Use JWT for auth"
am prompts respond <prompt-id> --action select_option --option 1
am prompts respond <prompt-id> --action reject --message "Missing error handling"

# Interactive prompt response (shows options, asks for input)
am prompts respond <prompt-id> -i
```

**Output example (`am prompts list`):**

```
  PROMPT ID    TASK                        TYPE            WAITING
  prm-abc      Fix login bug               needs_info      5m
  prm-def      Add pagination              options         12m
```

**Output example (`am prompts get prm-abc`):**

```
  Prompt: prm-abc
  Task: Fix login bug (task-abc)
  Type: needs_info
  Waiting: 5m
  ─────────────────────────────────────────────

  Agent is asking:

  Q1: What authentication provider should we use?
      Context: The task says 'add auth' but doesn't specify
      Options: [1] JWT  [2] OAuth 2.0  [3] Session-based

  Q2: Should we add rate limiting to the auth endpoints?
      Type: yes/no

  Actions:
    → provide_info    Respond with answers
    → cancel          Cancel the agent run

  Usage:
    am prompts respond prm-abc -i                     # interactive
    am prompts respond prm-abc --action provide_info \
      --answers '{"q1": "JWT", "q2": "yes"}'          # direct
```

---

### Events & History

```bash
# View task event log (the full activity stream)
am events list --task <task-id>
am events list --task <task-id> --category agent      # filter by category
am events list --task <task-id> --category transition
am events list --task <task-id> --category payload
am events list --task <task-id> --level error         # only errors
am events list --task <task-id> --limit 50

# View project-level events
am events list                                        # all events in current project
am events list --since "2026-02-10"
am events list --type agent.completed
am events list --json

# View activity feed (high-level, not per-task)
am activity                                           # recent project activity
am activity --limit 30
```

**Output example (`am events list --task task-abc`):**

```
  Feb 10, 10:00am  ● task.created          Task created
  Feb 10, 10:01am  ● status.changed        Open → Planning (user)
  Feb 10, 10:01am  ● agent.started         claude-code started (plan mode)
  Feb 10, 10:01am  ○ agent.tool_use        Read src/auth/middleware.ts
  Feb 10, 10:01am  ○ agent.tool_use        Search "jwt verification"
  Feb 10, 10:02am  ● agent.completed       claude-code completed (45s, $0.02)
  Feb 10, 10:02am  ● status.changed        Planning → Planned (agent: plan_complete)
  Feb 10, 10:03am  ● status.changed        Planned → In Progress (user)
  Feb 10, 10:03am  ● agent.started         claude-code started (implement mode)
```

---

### Pipeline Management

```bash
# List available pipeline definitions
am pipelines list
am pipelines ls                                       # alias

# Get pipeline details
am pipelines get <pipeline-id>
am pipelines get <pipeline-id> --json                 # full JSON definition
am pipelines show <pipeline-id>                       # alias

# View pipeline as visual graph (ASCII art)
am pipelines graph <pipeline-id>

# Export pipeline definition to file
am pipelines export <pipeline-id> > pipeline.json
am pipelines export <pipeline-id> --output pipeline.json

# Import pipeline definition from file
am pipelines import pipeline.json
am pipelines import pipeline.json --name "My Custom Pipeline"

# Set default pipeline
am pipelines set-default <pipeline-id>

# Assign pipeline to a task
am tasks update <task-id> --pipeline <pipeline-id>
```

**Output example (`am pipelines graph standard`):**

```
  Pipeline: Standard

  ┌──────┐     ┌──────────┐     ┌────────┐
  │ Open │────→│ Planning │────→│Planned │
  │      │     │  ⚙ agent │     │        │
  └──┬───┘     └──────────┘     └───┬────┘
     │                              │
     │   "skip plan"                │  "implement"
     │                              ▼
     │                    ┌─────────────┐
     └───────────────────→│ In Progress │←──────────┐
                          │  ⚙ agent    │           │
                          └──────┬──────┘           │
                                 │                  │
                       agent:success          "rework"
                                 │                  │
                          ┌──────▼──────┐    ┌──────┴─────────┐
                          │  PR Review  │───→│ Changes        │
                          │  ⚙ review   │    │ Requested      │
                          └──────┬──────┘    └────────────────┘
                                 │
                        "merge & complete"
                          ┌──────▼──────┐
                          │    Done     │
                          │  ● terminal │
                          └─────────────┘

  Legend:  ⚙ = has hooks  ── manual  ═══ agent
```

---

### Notes

```bash
# List notes on a task
am notes list <task-id>

# Add a note
am notes add <task-id> "Found the root cause - race condition in auth"
am notes add <task-id> --from-file notes.md
am notes add <task-id> -i                             # interactive (opens $EDITOR)

# Delete a note
am notes delete <note-id>
```

---

### Artifacts

```bash
# List artifacts for a task
am artifacts list <task-id>

# Add an artifact
am artifacts add <task-id> --type link --label "Design Doc" --url "https://..."
am artifacts add <task-id> --type branch --label "feature/auth" \
  --metadata '{"baseBranch": "main"}'

# Remove an artifact
am artifacts remove <artifact-id>
```

---

### Dependencies

```bash
# List task dependencies
am deps list <task-id>                                # what this task depends on
am deps list <task-id> --reverse                      # what depends on this task

# Add dependency
am deps add <task-id> <depends-on-task-id>

# Remove dependency
am deps remove <task-id> <depends-on-task-id>

# Visualize dependency graph
am deps graph                                         # full project dependency graph
am deps graph <task-id>                               # tree rooted at this task
```

---

### Settings

```bash
# View all settings
am settings list
am settings show                                      # alias

# Get specific setting
am settings get <key>

# Set a setting
am settings set <key> <value>
am settings set theme dark
am settings set default-priority high
am settings set default-agent claude-code
am settings set supervisor.enabled true
am settings set supervisor.interval-ms 60000

# Agent configuration
am settings agent                                     # show agent config
am settings agent set model claude-sonnet-4-5-20250929
am settings agent set max-turns 50
am settings agent set timeout 600000
```

---

### Status / Dashboard

```bash
# Quick status overview (project-level)
am status

# Output:
#   Project: My App (/Users/me/code/my-app)
#   Pipeline: Standard
#
#   Tasks:
#     Open:              5
#     Planning:          1 (agent running)
#     In Progress:       2 (1 agent running)
#     PR Review:         1
#     Changes Requested: 1
#     Done:              12
#     ─────────────────
#     Total:             22
#
#   Running agents: 2
#     - task-abc "Fix login bug" (claude-code, implement, 3m12s)
#     - task-def "Plan auth" (claude-code, plan, 0m45s)
#
#   Pending prompts: 1
#     - prm-ghi "Add pagination" (needs_info, waiting 12m)
#
#   Today's cost: $0.34 (3 runs)

# Detailed stats
am stats
am stats --since "2026-02-01"
am stats --json
```

---

## Output Modes

### Human-Readable (default)

Formatted tables, colors, Unicode symbols. Best for interactive use.

```bash
am tasks list
```

### JSON (`--json`)

Raw JSON output. Best for scripting, piping to `jq`, integration with other tools.

```bash
am tasks list --json | jq '.[].title'
am tasks get task-abc --json | jq '.status'
```

### Quiet (`--quiet`)

Minimal output — just IDs or success/failure. Best for scripting.

```bash
# Returns just the new task ID
TASK_ID=$(am tasks create --title "New task" --quiet)
echo $TASK_ID
# → task-abc-1234

# Returns nothing on success, error message on failure
am tasks transition task-abc in_progress --quiet
```

### Verbose (`--verbose`)

Full details without truncation. Shows all fields, full descriptions, full transcripts.

```bash
am tasks get task-abc --verbose     # full description, all artifacts, full history
am agent get run-abc --verbose      # full transcript, all tool_use events
```

---

## Interactive Mode

For complex operations, the CLI offers interactive mode with prompts:

```bash
# Create task interactively
am tasks create -i
# → Title: Fix login bug
# → Description (enter to skip, 'e' to open editor): e
# → [opens $EDITOR]
# → Priority [low/medium/high/critical] (medium): high
# → Size [xs/s/m/l/xl] (m): m
# → Complexity [simple/moderate/complex] (moderate):
# → Tags (comma-separated):auth,backend
# → Created: task-abc-1234

# Respond to prompt interactively
am prompts respond prm-abc -i
# → Agent is asking:
# →   Q1: What auth provider?
# →     [1] JWT
# →     [2] OAuth 2.0
# →     [3] Session-based
# → Your choice: 1
# →
# →   Q2: Add rate limiting? (y/n): y
# →
# → Sending response... done.
```

---

## Scripting & Automation

### Environment Variables

```bash
AM_PROJECT_ID=proj-abc                   # override project
AM_DB_PATH=/path/to/agents-manager.db    # override database location
AM_FORMAT=json                           # default to JSON output
AM_NO_COLOR=1                            # disable colors
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Resource not found |
| 4 | Validation error (e.g., guard blocked transition) |
| 5 | Database error (DB locked, corrupt, missing) |
| 6 | Authentication/permission error |

### Piping & Composition

```bash
# Create tasks from a list
cat task-titles.txt | while read title; do
  am tasks create --title "$title" --quiet
done

# Transition all open tasks to cancelled
am tasks list --status open --json | jq -r '.[].id' | while read id; do
  am tasks transition "$id" cancelled --quiet
done

# Export all tasks as JSON
am tasks list --json > tasks-backup.json

# Get total cost for a task
am agent runs --task task-abc --json | jq '[.[].tokenUsage.totalCost] | add'

# Watch all running agents
am agent runs --status running --json | jq -r '.[].id' | while read id; do
  echo "=== $id ==="
  am agent logs "$id" | tail -5
done
```

### Agent Integration

Running agents receive env vars and can use the CLI to interact with the task system:

```bash
# Inside an agent's environment:
export AM_PROJECT_ID=proj-abc
export AM_TASK_ID=task-def

# Agent can query context
am tasks get $AM_TASK_ID --json

# Agent can add notes
am notes add $AM_TASK_ID "Found root cause: race condition in auth middleware"

# Agent can query other tasks
am tasks list --tags "auth" --json

# Agent can check dependencies
am deps list $AM_TASK_ID --json
```

No HTTP callback URL needed — the CLI accesses the database directly.

---

## CLI ↔ UI Page Mapping

Every UI page has CLI equivalents:

| UI Page | CLI Command(s) |
|---------|---------------|
| Projects page | `am projects list`, `am projects create`, `am projects get` |
| Task Board (kanban) | `am tasks list` (grouped by status), `am status` |
| Task List (table) | `am tasks list` with filters |
| Task Detail | `am tasks get <id>`, `am tasks transitions <id>` |
| Task Form (create/edit) | `am tasks create`, `am tasks update` |
| Agent Runs page | `am agent runs` |
| Agent Run Detail | `am agent get <id>`, `am agent transcript <id>` |
| Agent Output (live) | `am agent watch <id>` |
| Workflow Visualizer | `am pipelines graph <id>` |
| Pipeline Editor | `am pipelines export/import` |
| Transition History | `am tasks history <id>` |
| Event Log | `am events list` |
| Pending Prompts | `am prompts list`, `am prompts respond` |
| Settings | `am settings list`, `am settings set` |
| Dashboard | `am status`, `am stats` |

---

## Implementation

### File Structure

```
src/
├── cli/                          # CLI tool source
│   ├── index.ts                  # Entry point, commander setup
│   ├── db.ts                     # Database initialization (opens SQLite, calls createAppServices)
│   ├── output/
│   │   ├── formatter.ts          # Output mode routing (json/table/quiet)
│   │   ├── table.ts              # Table formatter (human-readable)
│   │   └── colors.ts             # Color/symbol utilities
│   ├── commands/
│   │   ├── projects.ts           # am projects ...
│   │   ├── tasks.ts              # am tasks ...
│   │   ├── agent.ts              # am agent ...
│   │   ├── prompts.ts            # am prompts ...
│   │   ├── events.ts             # am events ...
│   │   ├── pipelines.ts          # am pipelines ...
│   │   ├── notes.ts              # am notes ...
│   │   ├── artifacts.ts          # am artifacts ...
│   │   ├── deps.ts               # am deps ...
│   │   ├── settings.ts           # am settings ...
│   │   └── status.ts             # am status, am stats
│   └── utils/
│       ├── project-detect.ts     # Auto-detect project from cwd
│       └── interactive.ts        # Interactive prompts (inquirer)
│
├── main/
│   └── ...                       # Same as before — no http-server.ts needed
```

### Dependencies

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "chalk": "^5.3.0",
    "cli-table3": "^0.6.3",
    "inquirer": "^9.2.0",
    "ora": "^7.0.1",
    "better-sqlite3": "^12.6.2"
  }
}
```

**Note:** Unlike the HTTP approach, the CLI **does** depend on `better-sqlite3` since it accesses the database directly. This is an acceptable tradeoff — `better-sqlite3` is already a project dependency (used by the Electron app), and the CLI shares the same build pipeline.

### CLI Initialization

```typescript
// src/cli/db.ts
import { createAppServices } from '../main/providers/setup';
import Database from 'better-sqlite3';
import { app } from 'electron'; // or use a hardcoded path for standalone CLI

const DB_PATH = process.env.AM_DB_PATH
  || path.join(os.homedir(), 'Library/Application Support/agents-manager/agents-manager.db');

let services: AppServices | null = null;

export function getServices(): AppServices {
  if (!services) {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    services = createAppServices(db);
  }
  return services;
}
```

### Command Registration

```typescript
// src/cli/index.ts

import { Command } from 'commander';
import { registerTaskCommands } from './commands/tasks';
import { registerAgentCommands } from './commands/agent';
// ...

const program = new Command();

program
  .name('am')
  .description('Agents Manager CLI')
  .version('1.0.0')
  .option('--project <id>', 'Override project ID')
  .option('--json', 'Output as JSON')
  .option('--verbose', 'Show full details')
  .option('--quiet', 'Minimal output')
  .option('--no-color', 'Disable colors')
  .option('--db <path>', 'Override database path');

// Each command module registers its subcommands
registerProjectCommands(program);
registerTaskCommands(program);
registerAgentCommands(program);
registerPromptCommands(program);
registerEventCommands(program);
registerPipelineCommands(program);
registerNoteCommands(program);
registerArtifactCommands(program);
registerDepCommands(program);
registerSettingsCommands(program);
registerStatusCommands(program);

program.parse();
```

### Example Command Implementation

```typescript
// src/cli/commands/tasks.ts

export function registerTaskCommands(program: Command) {
  const tasks = program.command('tasks').description('Manage tasks');

  tasks
    .command('list')
    .alias('ls')
    .description('List tasks')
    .option('--status <statuses>', 'Filter by status (comma-separated)')
    .option('--priority <priorities>', 'Filter by priority (comma-separated)')
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .option('--search <query>', 'Search title and description')
    .action(async (options) => {
      const { workflowService } = getServices();
      const projectId = await resolveProjectId(options);

      const filters: TaskFilters = {};
      if (options.status) filters.status = options.status.split(',');
      if (options.priority) filters.priority = options.priority.split(',');
      if (options.tags) filters.tags = options.tags.split(',');
      if (options.search) filters.search = options.search;

      const tasks = await workflowService.listTasks(projectId, filters);
      output(tasks, {
        table: formatTaskTable,
        json: tasks,
        quiet: tasks.map(t => t.id).join('\n'),
      });
    });

  tasks
    .command('create')
    .description('Create a new task')
    .option('--title <title>', 'Task title')
    .option('--description <desc>', 'Task description')
    .option('--priority <p>', 'Priority: low, medium, high, critical')
    .option('--size <s>', 'Size: xs, s, m, l, xl')
    .option('--complexity <c>', 'Complexity: simple, moderate, complex')
    .option('--tags <tags>', 'Tags (comma-separated)')
    .option('--parent <taskId>', 'Parent task ID')
    .option('--from-file <path>', 'Create from markdown file')
    .option('-i, --interactive', 'Interactive mode')
    .action(async (options) => {
      const { workflowService } = getServices();
      const projectId = await resolveProjectId(options);

      let input: CreateTaskInput;
      if (options.interactive) {
        input = await interactiveTaskCreate(projectId);
      } else if (options.fromFile) {
        input = await parseTaskFile(options.fromFile, projectId);
      } else {
        if (!options.title) {
          console.error('--title is required (or use -i for interactive mode)');
          process.exit(2);
        }
        input = {
          projectId,
          title: options.title,
          description: options.description,
          priority: options.priority || 'medium',
          size: options.size || 'm',
          complexity: options.complexity || 'moderate',
          tags: options.tags?.split(',') || [],
          parentTaskId: options.parent,
        };
      }

      const task = await workflowService.createTask(input);
      output(task, {
        table: () => console.log(`Created: ${task.id} "${task.title}"`),
        json: task,
        quiet: task.id,
      });
    });

  tasks
    .command('transition <taskId> <toStatus>')
    .alias('move')
    .description('Transition task to new status')
    .option('--reason <reason>', 'Reason for transition')
    .action(async (taskId, toStatus, options) => {
      const { workflowService } = getServices();
      const result = await workflowService.transitionTask(taskId, toStatus, {
        triggeredBy: 'user',
        reason: options.reason,
      });

      if (result.success) {
        output(result, {
          table: () => console.log(
            `${result.previousStatus} → ${result.newStatus}`
          ),
          json: result,
          quiet: '',
        });
      } else {
        console.error(`Transition blocked: ${result.error}`);
        process.exit(4);
      }
    });

  // Quick shortcuts
  tasks
    .command('start <taskId>')
    .description('Move task to first active status')
    .action(async (taskId) => {
      const { workflowService } = getServices();
      const transitions = await workflowService.getValidTransitions(taskId);
      const active = transitions.find(t =>
        t.transition.to && t.allowed
      );
      if (!active) {
        console.error('No valid transition to an active status');
        process.exit(4);
      }
      await workflowService.transitionTask(taskId, active.transition.to, {
        triggeredBy: 'user',
      });
    });
}
```

---

## Shell Completions

The CLI supports shell completions for bash, zsh, and fish:

```bash
# Generate completion script
am completion bash >> ~/.bashrc
am completion zsh >> ~/.zshrc
am completion fish >> ~/.config/fish/completions/am.fish

# Completions include:
# - Command names and subcommands
# - --flag names
# - Task IDs (queried from DB)
# - Status names (from pipeline)
# - Agent types
# - Project names
```

---

## Phase Rollout

### Phase 1: Foundation CLI

- CLI entry point with `createAppServices(db)` direct initialization
- Database path discovery (`AM_DB_PATH` env var or default location)
- `am projects` (list, create, get, update, delete)
- `am tasks` (list, create, get, update, delete)
- `am tasks transition` (pipeline transitions)
- `am tasks transitions` (valid transitions)
- `am tasks history` (transition history)
- `am pipelines` (list, get, graph, export)
- `am deps` (list, add, remove)
- `am status` (project overview)
- `am settings` (list, get, set)
- Output modes: `--json`, `--quiet`, `--verbose`
- Project auto-detection from cwd

### Phase 2: Agent CLI

- `am agent start/stop` (start and stop agents)
- `am agent runs/get` (list and inspect runs)
- `am agent watch` (poll-based live output)
- `am agent transcript` (view completed transcript)
- `am agent types` (list available agents)
- `am agent cost` (cost tracking)
- `am prompts list/get/respond` (human-in-the-loop)
- `am events` (task event log)
- `am notes` (task notes)
- `am artifacts` (task artifacts)

### Phase 3: Polish

- Interactive mode (`-i`) for all create/respond commands
- `am tasks create --from-file` (markdown + frontmatter)
- Shell completions (bash, zsh, fish)
- `am activity` (project activity feed)
- `am stats` (cost/performance stats)
- Bulk operations (`am tasks bulk-update/bulk-delete`)
- `am deps graph` (ASCII dependency graph)
