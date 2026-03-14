---
name: agents-manager
description: Use the `agents-manager` CLI to create, edit, delete, list, transition, and manage tasks, subtasks, dependencies, agents, and prompts. Use this skill whenever you need to interact with the task management system.
user-invocable: false
---

# Task Management via `agents-manager` CLI

Use the `agents-manager` CLI to manage tasks. It connects directly to the same SQLite database as the Electron app.

## How to Run

```bash
npx agents-manager <command> [args]
```

For the full CLI reference, see `docs/plan/architecture/workflow-cli.md`.
For the implemented commands reference, see `docs/cli-reference.md`.

## Quick Reference

```bash
# Tasks
agents-manager tasks list [--status <s>] [--priority <n>] [--assignee <name>]
agents-manager tasks get <id>
agents-manager tasks create --title "Title" [--description "desc"] [--priority <n>] [--assignee <name>] [--tags "t1,t2"]
agents-manager tasks update <id> [--title] [--description] [--priority] [--assignee] [--tags]
agents-manager tasks delete <id>
agents-manager tasks transition <id> <status> [--actor <name>]
agents-manager tasks transitions <id>
agents-manager tasks start <id>

# Subtasks
agents-manager tasks subtask list <taskId>
agents-manager tasks subtask add <taskId> --name "Name" [--status open|in_progress|done]
agents-manager tasks subtask update <taskId> --name "Name" --status <status>
agents-manager tasks subtask remove <taskId> --name "Name"

# Dependencies
agents-manager deps list <taskId>
agents-manager deps add <taskId> <depId>
agents-manager deps remove <taskId> <depId>

# Agents
agents-manager agent start <taskId> [--mode plan|implement|review] [--type scripted|claude-code]
agents-manager agent stop <runId>
agents-manager agent runs [--task <taskId>] [--active]

# Events, Prompts, Status
agents-manager events list --task <taskId> [--category <cat>]
agents-manager prompts list --task <taskId>
agents-manager prompts respond <id> --response '{"key":"value"}'
agents-manager projects list
agents-manager status
```

## Global Options

`--project <id>`, `--json`, `--quiet`, `--verbose`

## Notes

- `tasks list` requires a project context (auto-resolved from CWD, or use `--project <id>`)
- Task IDs are UUIDs — use `agents-manager tasks list` to find them
- If no `--pipeline` is given on create, the first available pipeline is used
- Use `--json` when parsing output for follow-up operations

---

## Task Pipeline

For the full pipeline architecture, see [`docs/pipeline-engine.md`](docs/pipeline-engine.md).

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
2. If prompt exists, respond to it: `prompts respond <promptId> --response '{"answer":"..."}'`
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
