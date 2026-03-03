---
title: CLI Reference
description: The agents-manager command-line tool, commands, and project context
summary: The agents-manager CLI is built with Commander.js and connects to the daemon process via an HTTP API client. It auto-starts the daemon if needed via ensureDaemon().
priority: 3
key_points:
  - "File: src/cli/index.ts"
  - "Run via: npx agents-manager"
  - "CLI is UI-only — no business logic; all commands delegate to daemon API client"
---
# CLI Reference

The `npx agents-manager` command-line tool, commands, and project context.

## Overview

**File:** `src/cli/index.ts`

The CLI is built with Commander.js and connects to the daemon process via an HTTP API client. It auto-starts the daemon if needed and delegates all operations through `src/client/api-client.ts`.

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

## Daemon Connection

**File:** `src/cli/ensure-daemon.ts`

The CLI connects to the daemon process via HTTP. On startup, `ensureDaemon()` checks if the daemon is already running and starts it if needed.

```typescript
const daemonUrl = await ensureDaemon();
const api = createApiClient(daemonUrl);
```

All commands delegate to the daemon API client (`src/client/api-client.ts`). The CLI never opens the database directly.

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

#### Core CRUD

```bash
npx agents-manager tasks list|ls [--status] [--type] [--size] [--complexity] [--priority] [--assignee] [--feature <id>] [--parent <id>] [--tag <tag>] [--search <text>]
npx agents-manager tasks get|show <id> [--field <name>]      # Get task details (optionally extract single field)
npx agents-manager tasks create --title <t> [--desc] [--type] [--size] [--complexity] [--pipeline] [--priority] [--assignee] [--tags] [--debug-info] [--feature <id>] [--parent-task <id>] [--pr-link] [--branch-name] [--metadata <json>]
npx agents-manager tasks update <id> [--title] [--desc] [--type] [--size] [--complexity] [--priority] [--assignee] [--tags] [--pipeline] [--debug-info] [--plan <text>] [--technical-design <text>] [--pr-link] [--branch-name] [--feature <id>] [--parent-task <id>] [--metadata <json>] [--phases <json>]
npx agents-manager tasks delete <id>
npx agents-manager tasks reset <id> [--pipeline <id>]
```

**`--field` option on `tasks get`:** Extracts a single field value in raw format (no table formatting). String fields output as plain text; object/array fields output as JSON. Valid fields: `plan`, `technicalDesign`, `debugInfo`, `phases`, `subtasks`, `metadata`, `prLink`, `branchName`, `description`, `type`, `size`, `complexity`, `tags`, `assignee`, `featureId`, `parentTaskId`.

**Stdin support for content fields:** Pass `-` as the value to read from stdin:
```bash
cat plan.md | npx agents-manager tasks update <id> --plan -
cat design.md | npx agents-manager tasks update <id> --technical-design -
```

**Clearing nullable fields:** Pass an empty string `""` to clear `--pr-link`, `--branch-name`, `--feature`, or `--parent-task`.

#### Transitions & Pipeline

```bash
npx agents-manager tasks transition|move <id> <status> [--actor]    # Transition task
npx agents-manager tasks force-transition <id> <status> [--actor]   # Force transition (bypass guards)
npx agents-manager tasks transitions <id>                           # Show valid transitions
npx agents-manager tasks all-transitions <id>                       # Show all pipeline transitions
npx agents-manager tasks start <id> [--actor]                       # Transition to first non-initial status
npx agents-manager tasks diagnostics <id>                           # Pipeline diagnostics
npx agents-manager tasks advance-phase <id>                         # Advance to next implementation phase
npx agents-manager tasks hook-retry <id> --hook <name> [--from <status>] [--to <status>]  # Retry a failed hook
npx agents-manager tasks guard-check <id> --to <status> --trigger <trigger>  # Check if transition is allowed
```

#### Context & Feedback

```bash
npx agents-manager tasks context list|ls <id>                       # List context entries
npx agents-manager tasks context add <id> --source <src> --type <type> --summary <text> [--data <json>]  # Add context entry
npx agents-manager tasks feedback <id> --type <type> --content <text>  # Add feedback
```

Feedback types: `plan_feedback`, `design_feedback`, `implementation_feedback`.

`--summary` and `--content` support stdin via `-`:
```bash
echo "Needs more detail on auth flow" | npx agents-manager tasks feedback <id> --type plan_feedback --content -
```

#### Artifacts, Timeline & Worktree

```bash
npx agents-manager tasks artifacts <id>                             # List task artifacts
npx agents-manager tasks timeline <id>                              # Get task timeline
npx agents-manager tasks worktree <id>                              # Get worktree info
```

#### Subtask Subcommand

```bash
npx agents-manager tasks subtask list|ls <taskId>            # List subtasks
npx agents-manager tasks subtask add <taskId> --name <n> [--status]  # Add subtask
npx agents-manager tasks subtask update <taskId> --name <n> --status <s>  # Update subtask
npx agents-manager tasks subtask remove <taskId> --name <n>  # Remove subtask
npx agents-manager tasks subtask set <taskId> --subtasks <json>  # Replace all subtasks
```

### `agent` — Agent Run Management

```bash
npx agents-manager agent start <taskId> [--mode] [--type] [--revision-reason <reason>]
npx agents-manager agent stop <taskId> <runId>               # Stop running agent
npx agents-manager agent message <taskId> --message <text>   # Send message to running agent
npx agents-manager agent review <taskId>                     # Trigger workflow review
npx agents-manager agent active-tasks                        # List task IDs with active agents
npx agents-manager agent runs [--task] [--active] [--all]    # List agent runs
npx agents-manager agent get|show <runId>                    # Get agent run details
```

`--revision-reason` values: `changes_requested`, `info_provided`, `conflicts_detected`.

`--message` supports stdin via `-`:
```bash
echo "approved" | npx agents-manager agent message <taskId> --message -
```

The `runs` subcommand defaults to showing active runs only. Use `--task <id>` to filter by task, `--active` to explicitly list active runs, or `--all` to show all runs including completed ones.

### `git` — Git Operations

#### Task-scoped (require `<taskId>`)

```bash
npx agents-manager git diff <taskId>                         # Show committed diff for task branch
npx agents-manager git log <taskId>                          # Show git log for task branch
npx agents-manager git status <taskId>                       # Show git status for task worktree
npx agents-manager git stat <taskId>                         # Show diffstat for task branch
npx agents-manager git working-diff <taskId>                 # Show uncommitted working diff
npx agents-manager git reset-file <taskId> --file <path>     # Reset a file in task worktree
npx agents-manager git clean <taskId>                        # Clean untracked files
npx agents-manager git pull <taskId> [--branch <name>]       # Pull latest changes
npx agents-manager git show <taskId> <hash>                  # Show a specific commit
npx agents-manager git pr-checks <taskId>                    # Get PR check results
```

#### Project-scoped (use `--project` / project context)

```bash
npx agents-manager git project-log [--count <n>]             # Show project git log
npx agents-manager git project-branch                        # Show current project branch
npx agents-manager git project-commit <hash>                 # Show a specific project commit
```

### `features` — Feature Management

```bash
npx agents-manager features list|ls                          # List features (requires project)
npx agents-manager features get|show <id>                    # Get feature details
npx agents-manager features create --title <t> [--description <d>]  # Create feature
npx agents-manager features update <id> [--title] [--description]   # Update feature
npx agents-manager features delete <id>                      # Delete feature
```

### `settings` — Application Settings

```bash
npx agents-manager settings get|show                         # Get current settings
npx agents-manager settings update [--theme <light|dark|system>] [--notifications <true|false>] [--default-pipeline <id>] [--current-project <id>] [--chat-agent-lib <lib>]
```

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

### `events` — Events & Activities

```bash
npx agents-manager events list --task <taskId> [--category]  # List task events
npx agents-manager events activities [--action <a>] [--entity-type <t>] [--entity-id <id>] [--limit <n>]  # List activity log entries
```

Event categories: `status_change`, `field_update`, `dependency_change`, `comment`, `system`, `agent`, `agent_debug`, `git`, `github`, `worktree`

### `telegram` — Telegram Bot Integration

```bash
npx agents-manager telegram start                            # Start the Telegram bot (long-running)
npx agents-manager telegram status                           # Show Telegram configuration status
```

The `start` command is long-running — it starts a Telegram bot that listens for commands and forwards notifications. Press Ctrl+C to stop. Requires `telegram.botToken` and `telegram.chatId` in the project config file (`<projectPath>/.agents-manager/config.json`).

### `daemon` — Daemon Lifecycle

```bash
npx agents-manager daemon start                            # Start the daemon process
npx agents-manager daemon stop                             # Stop the daemon process
npx agents-manager daemon status                           # Show daemon status (running/stopped, PID, port)
```

The `daemon` commands manage the background daemon process lifecycle. They do not require the daemon to be running (they are registered before `ensureDaemon()` is called).

### `status` — Dashboard

```bash
npx agents-manager status                                    # Show system dashboard
```

Displays: project count, task count, tasks by status, active agents, pending prompts.

### `logs` — Debug Logs

```bash
npx agents-manager logs list [--level] [--source] [--search] [--limit]  # List debug logs
npx agents-manager logs clear                                # Clear debug logs
```

## API Endpoint Mapping

| CLI Command | API Method |
|---|---|
| `tasks list` | `api.tasks.list(filter)` |
| `tasks get <id>` | `api.tasks.get(id)` |
| `tasks get <id> --field <name>` | `api.tasks.get(id)` → extract field |
| `tasks create` | `api.tasks.create(input)` |
| `tasks update <id>` | `api.tasks.update(id, input)` |
| `tasks delete <id>` | `api.tasks.delete(id)` |
| `tasks reset <id>` | `api.tasks.reset(id, pipelineId?)` |
| `tasks transition <id> <status>` | `api.tasks.transition(id, status, actor?)` |
| `tasks force-transition <id> <status>` | `api.tasks.forceTransition(id, status, actor?)` |
| `tasks transitions <id>` | `api.tasks.getTransitions(id)` |
| `tasks all-transitions <id>` | `api.tasks.getAllTransitions(id)` |
| `tasks diagnostics <id>` | `api.tasks.getPipelineDiagnostics(id)` |
| `tasks advance-phase <id>` | `api.tasks.advancePhase(id)` |
| `tasks hook-retry <id>` | `api.tasks.retryHook(id, hook, from?, to?)` |
| `tasks guard-check <id>` | `api.tasks.guardCheck(id, toStatus, trigger)` |
| `tasks context list <id>` | `api.tasks.getContext(id)` |
| `tasks context add <id>` | `api.tasks.addContext(id, input)` |
| `tasks feedback <id>` | `api.tasks.addFeedback(id, input)` |
| `tasks artifacts <id>` | `api.tasks.getArtifacts(id)` |
| `tasks timeline <id>` | `api.tasks.getTimeline(id)` |
| `tasks worktree <id>` | `api.tasks.getWorktree(id)` |
| `agent start <taskId>` | `api.agents.start(taskId, mode, type, reason?)` |
| `agent stop <taskId> <runId>` | `api.agents.stop(taskId, runId)` |
| `agent message <taskId>` | `api.agents.message(taskId, message)` |
| `agent review <taskId>` | `api.agents.workflowReview(taskId)` |
| `agent active-tasks` | `api.agents.getActiveTaskIds()` |
| `git diff <taskId>` | `api.git.getDiff(taskId)` |
| `git log <taskId>` | `api.git.getLog(taskId)` |
| `git status <taskId>` | `api.git.getStatus(taskId)` |
| `git stat <taskId>` | `api.git.getStat(taskId)` |
| `git working-diff <taskId>` | `api.git.getWorkingDiff(taskId)` |
| `git reset-file <taskId>` | `api.git.resetFile(taskId, path)` |
| `git clean <taskId>` | `api.git.clean(taskId)` |
| `git pull <taskId>` | `api.git.pull(taskId, branch?)` |
| `git show <taskId> <hash>` | `api.git.showCommit(taskId, hash)` |
| `git pr-checks <taskId>` | `api.git.getPRChecks(taskId)` |
| `git project-log` | `api.git.getProjectLog(projectId, count?)` |
| `git project-branch` | `api.git.getProjectBranch(projectId)` |
| `git project-commit <hash>` | `api.git.getProjectCommit(projectId, hash)` |
| `features list` | `api.features.list({ projectId })` |
| `features get <id>` | `api.features.get(id)` |
| `features create` | `api.features.create(input)` |
| `features update <id>` | `api.features.update(id, input)` |
| `features delete <id>` | `api.features.delete(id)` |
| `settings get` | `api.settings.get()` |
| `settings update` | `api.settings.update(partial)` |
| `events activities` | `api.events.listActivities(filter)` |

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

## Stdin Support

**File:** `src/cli/stdin.ts`

Several commands accept `-` as a value to read from stdin. This enables piping content from files or other commands:

```bash
# Pipe a plan from a file
cat plan.md | npx agents-manager tasks update <id> --plan -

# Pipe a technical design
cat design.md | npx agents-manager tasks update <id> --technical-design -

# Pipe feedback
echo "Needs auth flow details" | npx agents-manager tasks feedback <id> --type plan_feedback --content -

# Pipe a message to an agent
echo "approved" | npx agents-manager agent message <taskId> --message -

# Pipe context summary
echo "User reported login fails on Safari" | npx agents-manager tasks context add <id> --source user --type bug_report --summary -
```

## Scripting Patterns

Use `--json` for machine-readable output and `--quiet` for IDs-only:

```bash
# Get task ID after creation
TASK_ID=$(npx agents-manager tasks create --title "Fix bug" --quiet)

# Get plan as raw text
npx agents-manager tasks get $TASK_ID --field plan > plan.md

# Check active agents
npx agents-manager agent active-tasks --json | jq '.'

# List features as JSON
npx agents-manager features list --json
```

## Agent-CLI Interaction

Agents running in worktrees can call the CLI to update task state. For example, an agent can update subtask progress:

```bash
npx agents-manager tasks subtask update <taskId> --name "Step 1" --status done
```

This works because:
- The CLI auto-connects to the running daemon
- The agent worktree has `npx agents-manager` accessible via PATH
- The CLI connects to the same daemon process that manages the agent

## Edge Cases

- **Default agent type in CLI is `scripted`** — unlike the Electron UI which uses the agent type from the pipeline hooks. This is intentional for testing.
- **CLI and Electron both connect to the same daemon process via HTTP** — no direct DB access.
- **`tasks list` requires a project** — uses `requireProject()` which throws with a helpful message listing available projects if no project context can be resolved.
- **Subtask commands use a dedicated API endpoint** — subtask edits are lightweight field updates that do not need pipeline transition logic.
