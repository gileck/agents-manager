---
name: agents-manager
description: Use the `agents-manager` CLI to create, edit, delete, list, transition, and manage tasks, subtasks, dependencies, agents, and prompts. Use this skill whenever you need to interact with the task management system.
user-invocable: false
---

# Task Management via `agents-manager` CLI

Use the `agents-manager` CLI to manage tasks. It connects directly to the same SQLite database as the Electron app.

## How to Run

Run via the bootstrap script (resolves `@template` path aliases):

```bash
node bootstrap-cli.js <command> [args]
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
