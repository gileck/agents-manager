# CLI Reference

The `am` command-line tool, commands, and project context.

## Overview

**File:** `src/cli/index.ts`

The CLI is built with Commander.js and provides terminal access to the same services and database used by the Electron app.

```bash
am [options] <command> [subcommand]
```

### Global Options

| Option | Description |
|--------|-------------|
| `--project <id>` | Project ID to use |
| `--json` | Output as JSON |
| `--quiet` | Minimal output (IDs only) |
| `--verbose` | Verbose output |
| `--no-color` | Disable colored output |
| `--db <path>` | Database path override |

## Database Access

**File:** `src/cli/db.ts`

The CLI opens the same SQLite file as the Electron app:

```typescript
function openDatabase(flagPath?: string): { db: Database.Database; services: AppServices }
```

Path resolution:
1. `--db <path>` flag
2. `AM_DB_PATH` environment variable
3. Default: `~/Library/Application Support/agents-manager/agents-manager.db`

The database is lazy-opened on first command execution (not at program startup). WAL mode and foreign keys are enabled. Migrations run automatically.

The database is closed on process exit via `process.on('exit')`.

## Command Groups

### `projects` — Project Management

```bash
am projects list|ls                          # List all projects
am projects get <id>                         # Get project details
am projects create --name <n> [--desc] [--path]  # Create project
am projects update <id> [--name] [--desc] [--path]  # Update project
am projects delete <id>                      # Delete project
```

### `tasks` — Task Management

```bash
am tasks list|ls [--status] [--priority] [--assignee]  # List tasks (requires project)
am tasks get|show <id>                       # Get task with deps and valid transitions
am tasks create --title <t> [--desc] [--pipeline] [--priority] [--assignee] [--tags]
am tasks update <id> [--title] [--desc] [--priority] [--assignee] [--tags]
am tasks delete <id>                         # Delete task
am tasks transition|move <id> <status> [--actor]  # Transition task
am tasks transitions <id>                    # Show valid transitions
am tasks start <id> [--actor]                # Transition to first non-initial status
```

#### Subtask Subcommand

```bash
am tasks subtask list|ls <taskId>            # List subtasks
am tasks subtask add <taskId> --name <n> [--status]  # Add subtask
am tasks subtask update <taskId> --name <n> --status <s>  # Update subtask
am tasks subtask remove <taskId> --name <n>  # Remove subtask
am tasks subtask set <taskId> --subtasks <json>  # Replace all subtasks
```

### `agent` — Agent Run Management

```bash
am agent start <taskId> [--mode] [--type]    # Start agent (default mode: plan, default type: scripted)
am agent stop <runId>                        # Stop running agent
am agent runs [--task] [--active]            # List agent runs
am agent get|show <runId>                    # Get agent run details
```

### `pipelines` — Pipeline Viewing

```bash
am pipelines list|ls                         # List all pipelines
am pipelines get <id>                        # Get pipeline details
```

### `prompts` — Prompt Management

```bash
am prompts list --task <taskId>              # List pending prompts
am prompts respond <id> --response <json>    # Respond to a prompt
```

### `deps` — Dependency Management

```bash
am deps list <taskId>                        # List task dependencies
am deps add <taskId> <depId>                 # Add dependency
am deps remove <taskId> <depId>              # Remove dependency
```

### `events` — Task Events

```bash
am events list --task <taskId> [--category]  # List task events
```

Categories: `status_change`, `field_update`, `dependency_change`, `comment`, `system`, `agent`, `agent_debug`, `git`, `github`, `worktree`

### `status` — Dashboard

```bash
am status                                    # Show system dashboard
```

Displays: project count, task count, tasks by status, active agents, pending prompts.

## Project Context Resolution

**File:** `src/cli/context.ts`

Many commands require a project context. Resolution order:

1. **`--project <id>` flag** — highest priority
2. **`AM_PROJECT_ID` environment variable** — second priority
3. **CWD matching** — matches the current working directory against stored project paths

Two helper functions:
- `resolveProject()` — returns `Project | null`
- `requireProject()` — throws if no project found, displays available projects

## Output Formatting

**File:** `src/cli/output.ts`

| Mode | Description |
|------|-------------|
| `--json` | Pretty-printed JSON (2-space indent) |
| `--quiet` | IDs only (one per line for arrays) |
| Default | Table format with auto-calculated column widths |

## Agent-CLI Interaction

Agents running in worktrees can call the CLI to update task state. For example, an agent can update subtask progress:

```bash
am tasks subtask update <taskId> --name "Step 1" --status done
```

This works because:
- The CLI opens the same database file
- The agent worktree has `am` accessible via PATH
- SQLite WAL mode handles concurrent access

## Edge Cases

- **Default agent type in CLI is `scripted`** — unlike the Electron UI which defaults to `claude-code`. This is intentional for testing.
- **CLI is usable while Electron is running** — WAL mode allows concurrent read/write access from both processes.
- **Database is closed on process exit** — via `process.on('exit', () => db.close())` to prevent corruption.
- **`tasks list` requires a project** — uses `requireProject()` which throws with a helpful message listing available projects if no project context can be resolved.
