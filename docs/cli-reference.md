---
title: CLI Reference
description: The agents-manager command-line tool, commands, and project context
summary: The agents-manager CLI is built with Commander.js and shares the same WorkflowService and SQLite database as the Electron app. It instantiates services via createAppServices(db) directly — no IPC needed.
priority: 3
key_points:
  - "File: src/cli/index.ts"
  - "Run via: npx agents-manager"
  - "CLI is UI-only — no business logic; delegates everything to WorkflowService"
---
# CLI Reference

The `npx agents-manager` command-line tool, commands, and project context.

## Overview

**File:** `src/cli/index.ts`

The CLI is built with Commander.js and provides terminal access to the same services and database used by the Electron app.

```bash
npx agents-manager [options] <command> [subcommand]
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

The database is closed after the command completes via `.finally()` on the `parseAsync()` promise chain.

## Command Groups

### `projects` — Project Management

```bash
npx agents-manager projects list|ls                          # List all projects
npx agents-manager projects get <id>                         # Get project details
npx agents-manager projects create --name <n> [--desc] [--path]  # Create project
npx agents-manager projects update <id> [--name] [--desc] [--path]  # Update project
npx agents-manager projects delete <id>                      # Delete project
```

### `tasks` — Task Management

```bash
npx agents-manager tasks list|ls [--status] [--priority] [--assignee]  # List tasks (requires project)
npx agents-manager tasks get|show <id>                       # Get task with deps and valid transitions
npx agents-manager tasks create --title <t> [--desc] [--pipeline] [--priority] [--assignee] [--tags]
npx agents-manager tasks update <id> [--title] [--desc] [--priority] [--assignee] [--tags]
npx agents-manager tasks delete <id>                         # Delete task
npx agents-manager tasks transition|move <id> <status> [--actor]  # Transition task
npx agents-manager tasks transitions <id>                    # Show valid transitions
npx agents-manager tasks start <id> [--actor]                # Transition to first non-initial status
npx agents-manager tasks reset <id> [--pipeline <id>]        # Reset task to initial state
```

#### Subtask Subcommand

```bash
npx agents-manager tasks subtask list|ls <taskId>            # List subtasks
npx agents-manager tasks subtask add <taskId> --name <n> [--status]  # Add subtask
npx agents-manager tasks subtask update <taskId> --name <n> --status <s>  # Update subtask
npx agents-manager tasks subtask remove <taskId> --name <n>  # Remove subtask
npx agents-manager tasks subtask set <taskId> --subtasks <json>  # Replace all subtasks
```

**Note:** Subtask commands bypass WorkflowService and call `taskStore.updateTask()` directly. This is intentional — subtask updates are lightweight field edits that do not require pipeline transition logic.

### `agent` — Agent Run Management

```bash
npx agents-manager agent start <taskId> [--mode] [--type]    # Start agent (default mode: plan, default type: scripted)
npx agents-manager agent stop <runId>                        # Stop running agent
npx agents-manager agent runs [--task] [--active] [--all]    # List agent runs
npx agents-manager agent get|show <runId>                    # Get agent run details
```

The `runs` subcommand defaults to showing active runs only. Use `--task <id>` to filter by task, `--active` to explicitly list active runs, or `--all` to show all runs including completed ones.

### `pipelines` — Pipeline Viewing

```bash
npx agents-manager pipelines list|ls                         # List all pipelines
npx agents-manager pipelines get <id>                        # Get pipeline details
```

### `prompts` — Prompt Management

```bash
npx agents-manager prompts list --task <taskId>              # List pending prompts
npx agents-manager prompts respond <id> --response <json>    # Respond to a prompt
```

### `deps` — Dependency Management

```bash
npx agents-manager deps list <taskId>                        # List task dependencies
npx agents-manager deps add <taskId> <depId>                 # Add dependency
npx agents-manager deps remove <taskId> <depId>              # Remove dependency
```

### `events` — Task Events

```bash
npx agents-manager events list --task <taskId> [--category]  # List task events
```

Categories: `status_change`, `field_update`, `dependency_change`, `comment`, `system`, `agent`, `agent_debug`, `git`, `github`, `worktree`

### `telegram` — Telegram Bot Integration

```bash
npx agents-manager telegram start                            # Start the Telegram bot (long-running)
npx agents-manager telegram status                           # Show Telegram configuration status
```

The `start` command is long-running — it starts a Telegram bot that listens for commands and forwards notifications. Press Ctrl+C to stop. Requires `telegram.botToken` and `telegram.chatId` in the project config file (`<projectPath>/.agents-manager/config.json`).

The `status` command checks whether the Telegram configuration is present and displays the current state.

### `status` — Dashboard

```bash
npx agents-manager status                                    # Show system dashboard
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
npx agents-manager tasks subtask update <taskId> --name "Step 1" --status done
```

This works because:
- The CLI opens the same database file
- The agent worktree has `npx agents-manager` accessible via PATH
- SQLite WAL mode handles concurrent access

## Edge Cases

- **Default agent type in CLI is `scripted`** — unlike the Electron UI which defaults to `claude-code`. This is intentional for testing.
- **CLI is usable while Electron is running** — WAL mode allows concurrent read/write access from both processes.
- **Database is closed via `.finally()`** — on the `parseAsync()` promise chain to ensure cleanup even if a command throws.
- **`tasks list` requires a project** — uses `requireProject()` which throws with a helpful message listing available projects if no project context can be resolved.
- **Subtask commands bypass WorkflowService** — they call `taskStore.updateTask()` directly because subtask edits are lightweight field updates that do not need pipeline transition logic.
