---
name: agents-manager
description: Use the `agents-manager` CLI to create, edit, delete, list, transition, and manage tasks, subtasks, dependencies, agents, and prompts. Use this skill whenever you need to interact with the task management system.
user-invocable: false
---

# Task Management via `agents-manager` CLI

Use the `agents-manager` CLI to manage tasks. It communicates with the agents-manager daemon via HTTP API. The daemon is auto-started transparently when you run any non-daemon command.

## How to Run

```bash
npx agents-manager <command> [args]
```

## ⚠️ `--help` Behavior

Running `agents-manager --help` or `agents-manager -h` **only shows `daemon`** — all other commands are skipped because they require the daemon to be running first. To get help for a specific command, run it with `--help` after the command name:

```bash
# These work correctly:
agents-manager tasks --help
agents-manager tasks create --help
agents-manager agent --help
```

## Global Options

| Option | Description |
|--------|-------------|
| `--project <id>` | Project ID (auto-resolved from CWD if omitted) |
| `--json` | Output as JSON (recommended for scripting) |
| `--quiet` | Minimal output (IDs only) |
| `--verbose` | Verbose output |
| `--no-color` | Disable colored output |

## Special Behaviors

- **Daemon auto-start**: All non-daemon commands silently auto-start the daemon if it is not already running.
- **stdin support**: Several flags accept `-` as a value to read from stdin. Useful for piping large text (plans, designs, messages, feedback). Flags that support stdin: `--plan -`, `--technical-design -`, `--message -`, `--content -`, `--summary -`.
- **Clearing optional fields**: Pass an empty string `""` to clear a nullable field, e.g. `--size ""` sets `size` to `null`.
- **Task ID resolution**: Task IDs are UUIDs. Most commands also accept a short prefix and resolve to the full ID.
- **Project context**: Commands that list or create tasks require a project context. This is auto-resolved from CWD, or provide `--project <id>` explicitly.

---

## Command Reference

### `tasks` — Manage tasks

#### `tasks list` (alias: `ls`)

```bash
agents-manager tasks list [--status <s>] [--type bug|feature|improvement]
  [--size xs|sm|md|lg|xl] [--complexity low|medium|high]
  [--priority <n>] [--assignee <name>] [--feature <id>]
  [--parent <id>] [--tag <tag>] [--search <text>]
```

#### `tasks get <id>` (alias: `show`)

```bash
agents-manager tasks get <id> [--field <name>]
```

`--field` extracts a single raw field value. Valid fields: `plan`, `technicalDesign`, `debugInfo`, `phases`, `subtasks`, `metadata`, `prLink`, `branchName`, `description`, `type`, `size`, `complexity`, `tags`, `assignee`, `featureId`, `parentTaskId`.

The full task object also includes `dependencies` and `validTransitions` when retrieved without `--field`.

#### `tasks create` (**`--title` and `--type` are required**)

```bash
agents-manager tasks create \
  --title "Title" \
  --type bug|feature|improvement \
  [--description "desc"] \
  [--size xs|sm|md|lg|xl] \
  [--complexity low|medium|high] \
  [--pipeline <id>] \
  [--priority <n>] \
  [--assignee <name>] \
  [--tags "t1,t2"] \
  [--debug-info "text"] \
  [--feature <featureId>] \
  [--parent-task <taskId>] \
  [--pr-link <url>] \
  [--branch-name <name>] \
  [--metadata '{"key":"value"}']
```

If `--pipeline` is omitted, the default pipeline from settings is used (falls back to `pipeline-agent`).

#### `tasks update <id>`

```bash
agents-manager tasks update <id> \
  [--title "Title"] \
  [--description "desc"] \
  [--type bug|feature|improvement] \
  [--size xs|sm|md|lg|xl|""] \
  [--complexity low|medium|high|""] \
  [--priority <n>] \
  [--assignee <name>|""] \
  [--tags "t1,t2"] \
  [--pipeline <id>] \
  [--debug-info "text"] \
  [--plan "text or -"] \
  [--technical-design "text or -"] \
  [--pr-link <url>|""] \
  [--branch-name <name>|""] \
  [--feature <id>|""] \
  [--parent-task <id>|""] \
  [--metadata '{"key":"value"}'] \
  [--phases '[{"name":"Phase 1","description":"..."}]']
```

Use `""` to clear optional nullable fields (sets them to `null`). Use `-` with `--plan` or `--technical-design` to read from stdin.

#### `tasks delete <id>`

```bash
agents-manager tasks delete <id>
```

#### `tasks reset <id>`

Reset a task to its initial pipeline state.

```bash
agents-manager tasks reset <id> [--pipeline <id>]
```

`--pipeline` optionally switches the task to a different pipeline during reset.

#### `tasks transition <id> <status>` (alias: `move`)

```bash
agents-manager tasks transition <id> <status> [--actor <name>]
```

Transitions a task to the given status. Fails (with guard failure details) if guards block the transition.

#### `tasks force-transition <id> <status>`

```bash
agents-manager tasks force-transition <id> <status> [--actor <name>]
```

Bypasses guards. Use when recovering a stuck task.

#### `tasks transitions <id>`

```bash
agents-manager tasks transitions <id>
```

Lists the currently valid transitions for a task (from, to, trigger, label).

#### `tasks all-transitions <id>`

```bash
agents-manager tasks all-transitions <id>
```

Lists all transitions defined in the task's pipeline (not filtered by current state).

#### `tasks diagnostics <id>`

```bash
agents-manager tasks diagnostics <id>
```

Returns pipeline diagnostics for the task (guard states, hook states, phase info).

#### `tasks advance-phase <id>`

```bash
agents-manager tasks advance-phase <id>
```

Manually advance the task to its next implementation phase.

#### `tasks hook-retry <id>` (**`--hook` is required**)

```bash
agents-manager tasks hook-retry <id> --hook <hookName> [--from <status>] [--to <status>]
```

Retries a failed hook. Hook names: `start_agent`, `push_and_create_pr`, `merge_pr`, `advance_phase`, `create_prompt`, `notify`.

#### `tasks guard-check <id>` (**`--to` and `--trigger` are required**)

```bash
agents-manager tasks guard-check <id> --to <status> --trigger <trigger>
```

Checks if a transition would be allowed without executing it.

#### `tasks start <id> <status>`

```bash
agents-manager tasks start <id> <status> [--actor <name>]
```

Alias for `transition`. Shows available statuses if `<status>` is omitted.

#### `tasks context list <id>` (alias: `ls`)

```bash
agents-manager tasks context list <id>
```

Lists context entries attached to a task (source, type, summary, addressed, createdAt).

#### `tasks context add <id>` (**`--source`, `--type`, `--summary` are required**)

```bash
agents-manager tasks context add <id> \
  --source <src> \
  --type <entryType> \
  --summary "text or -" \
  [--data '{"key":"value"}']
```

Use `-` with `--summary` to read from stdin.

#### `tasks feedback <id>` (**`--type` and `--content` are required**)

```bash
agents-manager tasks feedback <id> \
  --type plan_feedback|design_feedback|implementation_feedback \
  --content "text or -"
```

Use `-` with `--content` to read from stdin.

#### `tasks artifacts <id>`

```bash
agents-manager tasks artifacts <id>
```

Lists artifacts produced by agents for a task.

#### `tasks timeline <id>`

```bash
agents-manager tasks timeline <id>
```

Returns a chronological timeline of events for a task.

#### `tasks worktree <id>`

```bash
agents-manager tasks worktree <id>
```

Returns worktree information for a task (path, branch, lock status).

#### `tasks subtask list <taskId>` (alias: `ls`)

```bash
agents-manager tasks subtask list <taskId>
```

#### `tasks subtask add <taskId>` (**`--name` is required**)

```bash
agents-manager tasks subtask add <taskId> --name "Name" [--status open|in_progress|done]
```

Default status is `open`.

#### `tasks subtask update <taskId>` (**`--name` and `--status` are required**)

```bash
agents-manager tasks subtask update <taskId> --name "Name" --status open|in_progress|done
```

#### `tasks subtask remove <taskId>` (**`--name` is required**)

```bash
agents-manager tasks subtask remove <taskId> --name "Name"
```

#### `tasks subtask set <taskId>` (**`--subtasks` is required**)

```bash
agents-manager tasks subtask set <taskId> --subtasks '[{"name":"Sub 1","status":"open"}]'
```

Replaces all subtasks with the provided JSON array.

---

### `agent` — Manage agent runs

#### `agent stop <taskId> <runId>`

```bash
agents-manager agent stop <taskId> <runId>
```

Stops a running agent.

#### `agent message <taskId>` (**`--message` is required**)

```bash
agents-manager agent message <taskId> --message "text or -"
```

Sends a message to a running agent. Use `-` with `--message` to read from stdin.

#### `agent review <taskId>`

```bash
agents-manager agent review <taskId>
```

Triggers a workflow review for a task.

#### `agent active-tasks`

```bash
agents-manager agent active-tasks
```

Lists task IDs that currently have active agents.

#### `agent runs`

```bash
agents-manager agent runs [--task <taskId>] [--active] [--all]
```

Lists agent runs. Default (no flags): shows only active runs. `--task` filters by task. `--all` shows all runs including completed.

#### `agent get <runId>` (alias: `show`)

```bash
agents-manager agent get <runId>
```

Returns full details of an agent run.

---

### `deps` — Manage task dependencies

```bash
agents-manager deps list <taskId>
agents-manager deps add <taskId> <depId>
agents-manager deps remove <taskId> <depId>
```

---

### `events` — View events and activities

#### `events list` (**`--task` is required**)

```bash
agents-manager events list --task <taskId> [--category <cat>]
```

Categories: `status_change`, `system`, `hook_execution`, `agent`, `agent_debug`, `git`, `github`, `worktree`.

#### `events activities`

```bash
agents-manager events activities [--action <action>] [--entity-type <type>] [--entity-id <id>] [--limit <n>]
```

Lists activity log entries (high-level chronological summary).

---

### `prompts` — Manage agent prompts

#### `prompts list` (**`--task` is required**)

```bash
agents-manager prompts list --task <taskId>
```

Lists pending prompts for a task, including questions and options.

#### `prompts respond <id>` (**`--response` is required**)

```bash
agents-manager prompts respond <id> --response '{"answers":[{"questionId":"q1","selectedOptionId":"opt1"}]}'
```

For text-answer questions:
```bash
agents-manager prompts respond <id> --response '{"answers":[{"questionId":"q1","text":"my answer"}]}'
```

---

### `projects` — Manage projects

```bash
agents-manager projects list
agents-manager projects get <id>
agents-manager projects create --name "Name" [--description "desc"] [--path "/path"]
agents-manager projects update <id> [--name "Name"] [--description "desc"] [--path "/path"]
agents-manager projects delete <id>
```

---

### `features` — Manage features

```bash
agents-manager features list
agents-manager features get <id>
agents-manager features create --title "Title" [--description "desc"]
agents-manager features update <id> [--title "Title"] [--description "desc"]
agents-manager features delete <id>
```

---

### `settings` — Application settings

```bash
agents-manager settings get
agents-manager settings update \
  [--theme light|dark|system] \
  [--notifications true|false] \
  [--default-pipeline <id>] \
  [--current-project <id>] \
  [--chat-agent-lib <lib>]
```

---

### `logs` — App debug logs

```bash
agents-manager logs list [--level debug|info|warn|error] [--source <src>] [--search <text>] [--limit <n>]
agents-manager logs clear [--older-than <days>]
```

Default `--limit` is 50.

---

### `git` — Git operations

#### Task-scoped commands (operate on the task's worktree/branch)

```bash
agents-manager git diff <taskId>           # Committed diff for task branch
agents-manager git log <taskId>            # Git log for task branch
agents-manager git status <taskId>         # Git status for task worktree
agents-manager git stat <taskId>           # Diffstat for task branch
agents-manager git working-diff <taskId>   # Uncommitted working diff
agents-manager git reset-file <taskId> --file <path>   # Reset a file in worktree
agents-manager git clean <taskId>          # Clean untracked files in worktree
agents-manager git pull <taskId> [--branch <name>]     # Pull latest changes
agents-manager git show <taskId> <hash>    # Show a specific commit
agents-manager git pr-checks <taskId>      # Get PR check results
```

#### Project-scoped commands (operate on the main project repository)

```bash
agents-manager git project-log [--count <n>]      # Git log for project repo
agents-manager git project-branch                 # Current branch of project repo
agents-manager git project-commit <hash>          # Show commit in project repo
```

---

### `pipelines` — View pipelines

```bash
agents-manager pipelines list
agents-manager pipelines get <id>
```

---

### `telegram` — Telegram bot integration

```bash
agents-manager telegram start    # Start the Telegram bot for current project
agents-manager telegram stop     # Stop the Telegram bot
agents-manager telegram status   # Show Telegram bot status
```

---

### `daemon` — Manage the daemon

The daemon is the HTTP server that all other commands communicate with. It is auto-started transparently when you run any non-daemon command.

```bash
agents-manager daemon start [-d|--detach]   # Start daemon (--detach runs in background)
agents-manager daemon stop                  # Stop the running daemon
agents-manager daemon status                # Check if daemon is running
```

**Note:** `daemon` is the only command visible via `agents-manager --help` (all others require the daemon to be running first).

---

### `status` — System status dashboard

```bash
agents-manager status
```

Shows: number of projects, total tasks, tasks by status, active agent runs, pending prompts.

---

## Common Workflows

### Create a task and start it

```bash
# 1. Create a task (--type is required)
agents-manager tasks create --title "Fix login bug" --type bug --description "Login fails on empty password" --json

# 2. Transition to open (start the pipeline)
agents-manager tasks transition <taskId> open

# 3. Check valid next transitions
agents-manager tasks transitions <taskId>

# 4. Start investigating
agents-manager tasks transition <taskId> investigating
```

### Check task status and history

```bash
# Full task details
agents-manager tasks get <taskId> --json

# Extract just the plan
agents-manager tasks get <taskId> --field plan

# See all events
agents-manager events list --task <taskId>

# See status change history only
agents-manager events list --task <taskId> --category status_change

# See activity summary
agents-manager events activities --entity-id <taskId>
```

### Respond to a pending prompt

```bash
# 1. Find pending prompts
agents-manager prompts list --task <taskId>

# 2. Respond with an option selection
agents-manager prompts respond <promptId> --response '{"answers":[{"questionId":"q1","selectedOptionId":"opt1"}]}'

# 3. For a text answer
agents-manager prompts respond <promptId> --response '{"answers":[{"questionId":"q1","text":"Use JWT tokens"}]}'
```

### Update a task's plan from a file

```bash
cat my-plan.md | agents-manager tasks update <taskId> --plan -
```

### Fix a stuck task

```bash
# 1. Check current status and diagnostics
agents-manager tasks get <taskId> --json
agents-manager tasks diagnostics <taskId>

# 2. Check agent runs
agents-manager agent runs --task <taskId>

# 3. Check events for errors
agents-manager events list --task <taskId> --category system
agents-manager events list --task <taskId> --category hook_execution

# 4. Force-transition to a known-good status
agents-manager tasks force-transition <taskId> open
```

---

## Task Pipeline

Every task is bound to a pipeline that controls its lifecycle. The only pipeline is `AGENT_PIPELINE`.

### Pipeline Statuses

```
open → investigating → investigation_review → designing → design_review → planning → plan_review → implementing → pr_review → ready_to_merge → done
```

Additional statuses: `backlog`, `needs_info`, `workflow_review`, `closed`.

**Status categories:**
- **ready:** `open`, `backlog` — entry points
- **agent_running:** `investigating`, `designing`, `planning`, `implementing`, `workflow_review` — an agent is actively working
- **human_review:** `investigation_review`, `design_review`, `plan_review`, `pr_review`, `ready_to_merge` — awaiting human decision
- **waiting_for_input:** `needs_info` — agent paused, waiting for human info
- **terminal:** `done`, `closed`

### Transition Triggers

- **manual** — user-initiated (UI/CLI), e.g. approving a review, closing a task
- **agent** — fired when an agent completes with a specific `agentOutcome`, e.g. `pr_ready`, `investigation_complete`
- **system** — autonomous, e.g. phase cycling after merge

### Key Transition Flows

**Happy path (single-phase):**
`open → investigating → investigation_review → designing → design_review → planning → plan_review → implementing → pr_review → ready_to_merge → done`

**Agent outcomes that drive transitions:**
| Outcome | From → To | Meaning |
|---------|-----------|---------|
| `investigation_complete` | investigating → investigation_review | Investigation finished |
| `design_ready` | designing → design_review | Design finished |
| `plan_complete` | planning → plan_review | Plan finished |
| `pr_ready` | implementing → pr_review | Code pushed, PR created |
| `approved` | pr_review → ready_to_merge | Reviewer agent approved |
| `needs_info` | any agent phase → needs_info | Agent needs human input |
| `info_provided` | needs_info → original phase | Human answered, agent resumes |
| `failed` | implementing → implementing (self-loop) | Agent failed, retry (max 3) |
| `conflicts_detected` | implementing → implementing (self-loop) | Merge conflicts, agent resolves |
| `no_changes` | implementing → open | No code changes needed |

### Guards

Guards are synchronous checks that block a transition if they fail:

| Guard | Purpose |
|-------|---------|
| `no_running_agent` | Prevents overlapping agent runs for same task |
| `max_retries(3)` | Blocks after 4+ failed/cancelled runs (prevents infinite loops) |
| `has_pending_phases` | Ensures phases remain for phase cycling |
| `has_following_phases` | Ensures more phases exist after current |
| `is_admin` | Gates merge operations to admin actors |

### Hooks

Hooks are async side-effects that run after a successful transition:

| Hook | Policy | Purpose |
|------|--------|---------|
| `start_agent` | fire_and_forget | Kicks off agent execution asynchronously |
| `push_and_create_pr` | required | Pushes branch + creates PR; **rollback on failure** |
| `merge_pr` | required | Merges PR via GitHub; **rollback on failure** |
| `advance_phase` | best_effort | Marks phase done; cycles to next if more remain |
| `create_prompt` | required | Creates a pending prompt for human input; **rollback on failure** |
| `notify` | best_effort | Sends notifications (Telegram) |

**Hook policies:**
- **required** — awaited; if it fails, the transition is rolled back (status reverts)
- **best_effort** — awaited; failures are logged but transition still succeeds
- **fire_and_forget** — not awaited; runs in background

### Multi-Phase Tasks

Tasks can have multiple implementation phases. After merge (`ready_to_merge → done`), the `advance_phase` hook checks for pending phases. If more exist, a system transition `done → implementing` fires automatically, cycling the task back. When all phases are complete, a final PR (task branch → main) is created and the task goes to `done → pr_review` for final review.

---

## Debugging Tasks with Events

When a task is stuck or behaving unexpectedly, events are the primary debugging tool.

### Step 1: Get the task status

```bash
agents-manager tasks get <taskId> --json
```

Check: current `status`, `prLink`, `branchName`, `metadata` (phases, errors).

### Step 2: List events to see what happened

```bash
# All events (excluding noisy debug logs)
agents-manager events list --task <taskId>

# Filter by category for targeted investigation
agents-manager events list --task <taskId> --category status_change
agents-manager events list --task <taskId> --category system
agents-manager events list --task <taskId> --category hook_execution
agents-manager events list --task <taskId> --category agent
agents-manager events list --task <taskId> --category git
```

**Event categories:**
| Category | What it tells you |
|----------|------------------|
| `status_change` | Every transition: `fromStatus`, `toStatus`, `trigger`, `actor` |
| `system` | Guard failures, rollbacks, recovery actions, critical errors |
| `hook_execution` | Hook start/success/failure with error details |
| `agent` | Agent started/completed, outcome value |
| `agent_debug` | Raw agent output (high-volume, use only when needed) |
| `git` | Branch creation, rebase, push operations |
| `github` | PR created, merged, status checks |
| `worktree` | Worktree create/lock/unlock/delete |

### Step 3: Check activity log for high-level overview

```bash
agents-manager events activities --entity-id <taskId>
```

This shows a chronological summary: task created, transitions, agent starts/completions, prompt responses.

### Step 4: Check agent runs

```bash
agents-manager agent runs --task <taskId>
```

Shows all agent runs for the task with their status and outcome.

### Common Debugging Scenarios

**Task stuck in `agent_running` status (investigating/designing/planning/implementing):**
1. Check `agent runs --task <taskId>` — is an agent actually running?
2. If no active agent, the task is orphaned. Check `events --category system` for errors.
3. Check `events --category hook_execution` — did a `start_agent` hook fail?
4. Fix: manually transition the task back or force-transition.

**Task stuck in `needs_info`:**
1. Check `prompts list --task <taskId>` — is there a pending prompt?
2. If prompt exists, respond to it: `prompts respond <promptId> --response '{"answers":[{"questionId":"q1","text":"..."}]}'`
3. After responding, the pipeline auto-transitions back to the original agent phase.

**Transition was rolled back:**
1. Look for `system` events with severity `error` mentioning "rolled back".
2. Check `hook_execution` events — which required hook failed?
3. Common cause: `push_and_create_pr` fails due to merge conflicts or git errors.
4. Check `git` events for rebase/push failure details.

**Agent keeps retrying (self-loop):**
1. Check `status_change` events — look for repeated `implementing → implementing` transitions.
2. Check `agent` events for the `failed` outcome and error details.
3. After 4 failed runs, the `max_retries` guard blocks further retries.
4. Check `system` events for guard denial messages.

**PR creation failed:**
1. Check `hook_execution` events for `push_and_create_pr` failure.
2. Check `git` events for push errors (auth, conflicts, branch protection).
3. Check `github` events for PR creation errors.
4. The transition will have been rolled back — task returns to `implementing`.

**Task jumped to unexpected status:**
1. Check `status_change` events — trace every transition chronologically.
2. Look at the `trigger` field: was it `manual`, `agent`, or `system`?
3. System transitions often come from phase cycling (`advance_phase` hook).
4. Check if a force-transition was used (look for `_forced: true` in transition history).
