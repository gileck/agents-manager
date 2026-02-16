# Phase 3: CLI Tool + Multi-Agent Support

> CLI tool (`am`) with direct DB access so agents can read/update tasks. Support for Cursor, Aider, and custom agents.

## Depends on: Phase 2 complete

---

## 3.1 — CLI Scaffold + DB Access
**Vertical slice:** `am` command runs, connects to same SQLite DB as Electron app.

- [ ] CLI entry point (`src/cli/index.ts`) with commander.js
- [ ] Database initialization (`src/cli/db.ts`) — same DB path as Electron
- [ ] `createAppServices(db)` — same composition root as Electron
- [ ] Global flags: `--project`, `--json`, `--verbose`, `--quiet`, `--no-color`, `--db`
- [ ] Exit codes (0=success, 1=error, 2=invalid args, 3=not found, 4=validation, 5=db, 6=auth)
- [ ] Output formatting utilities (table, JSON, quiet modes)

**Arch docs:** `architecture/workflow-cli.md` (Architecture, Global Flags)

---

## 3.2 — CLI: Project Commands
**Vertical slice:** `am projects list|get|create|update|delete` works.

- [ ] `am projects list` — table of all projects
- [ ] `am projects get <id>` — project details
- [ ] `am projects create --name --path --description` — create project
- [ ] `am projects update <id> --name --path` — update project
- [ ] `am projects delete <id>` — delete project (with confirmation)
- [ ] Project auto-detection from cwd (`getByPath`)
- [ ] `AM_PROJECT_ID` env var support

**Arch docs:** `architecture/workflow-cli.md` (Project Commands)

---

## 3.3 — CLI: Task Commands
**Vertical slice:** `am tasks list|get|create|update|delete|transition` works.

- [ ] `am tasks list` — filtered task table (--status, --priority, --assignee)
- [ ] `am tasks get <id>` — task details with dependencies and artifacts
- [ ] `am tasks create --title --description --priority --tags` — create task
- [ ] `am tasks update <id> --title --status --priority` — update task
- [ ] `am tasks delete <id>` — delete task
- [ ] `am tasks transition <id> <status>` — execute transition
- [ ] `am tasks transitions <id>` — show valid transitions
- [ ] `am tasks start <id>` — shortcut to start agent on task

**Arch docs:** `architecture/workflow-cli.md` (Task Commands)

---

## 3.4 — CLI: Agent Commands
**Vertical slice:** `am agent start|stop|runs|get` works.

- [ ] `am agent start <taskId> --mode --type` — start agent on task
- [ ] `am agent stop <runId>` — stop running agent
- [ ] `am agent runs` — list agent runs (--active, --task)
- [ ] `am agent get <runId>` — agent run details with transcript
- [ ] `am agent types` — list available agent types
- [ ] `am agent cost` — cost summary

**Arch docs:** `architecture/workflow-cli.md` (Agent Commands)

---

## 3.5 — CLI: Supporting Commands
**Vertical slice:** Events, prompts, pipelines, settings, status all work.

- [ ] `am events list --task <id>` — task event log
- [ ] `am prompts list --task <id>` — pending prompts
- [ ] `am prompts respond <id> --data` — respond to prompt (JSON)
- [ ] `am pipelines list|get` — pipeline definitions
- [ ] `am settings list|get|set` — app settings
- [ ] `am status` — project overview dashboard
- [ ] `am deps list|add|remove --task <id>` — dependency management

**Arch docs:** `architecture/workflow-cli.md` (Supporting Commands)

---

## 3.6 — Multi-Agent: Cursor Agent
**Vertical slice:** Can run Cursor CLI as an agent type.

- [ ] `CursorAgent` implementation
- [ ] Cursor CLI detection and availability check
- [ ] Prompt assembly for Cursor
- [ ] Output capture and outcome parsing
- [ ] Register in agent framework

**Arch docs:** `architecture/agent-platform.md` (Multi-Agent)

---

## 3.7 — Multi-Agent: Aider Agent
**Vertical slice:** Can run Aider as an agent type.

- [ ] `AiderAgent` implementation
- [ ] Aider CLI detection and availability check
- [ ] Prompt assembly for Aider
- [ ] Output capture and outcome parsing
- [ ] Register in agent framework

**Arch docs:** `architecture/agent-platform.md` (Multi-Agent)

---

## 3.8 — Multi-Agent: Custom Agent (Generic CLI Wrapper)
**Vertical slice:** User can define custom agents via CLI command template.

- [ ] `CustomAgent` implementation — wraps any CLI command
- [ ] Config: command template, output format, timeout
- [ ] Environment variables injected: `$AM_PROJECT_ID`, `$AM_TASK_ID`, `$AM_WORKDIR`
- [ ] Register custom agents from project config

**Arch docs:** `architecture/agent-platform.md` (Custom Agents)

---

## 3.9 — Agent Configuration System
**Vertical slice:** Agent configs are mergeable from global → project → run-level.

- [ ] Global config file (`~/.agents-manager/config.json`)
- [ ] Project config file (`<project>/.agents-manager/config.json`)
- [ ] Per-agent type settings (model, maxTurns, timeout, allowedTools)
- [ ] Config merge hierarchy: agent defaults → global → project → run overrides
- [ ] Agent resolver: hook params → project default → global default
- [ ] Instructions file support (`.agents-manager/instructions.md` injected into prompts)

**Arch docs:** `architecture/agent-platform.md` (Configuration)

---

## 3.10 — Task Supervisor (Background Health Loop)
**Vertical slice:** Background process monitors agent health and handles stuck states.

- [ ] `TaskSupervisor` service with configurable interval
- [ ] Detect dead agent processes (no updates for N minutes)
- [ ] Detect agent timeouts (exceeded max duration)
- [ ] Detect stuck waiting tasks (pending prompt too long)
- [ ] Auto-mark dead agents as failed
- [ ] Event logging for supervisor actions
- [ ] Supervisor configuration in settings (enabled, intervals, thresholds)

**Arch docs:** `architecture/pipeline/errors.md` (Supervisor)

---

## 3.11 — ProjectValidator (Build/Lint/Test Checks)
**Vertical slice:** After agent execution, project checks run to validate output.

- [ ] `ProjectValidator` service
- [ ] Run configurable checks: build, lint, test, type-check
- [ ] Check commands from project config (`.agents-manager/config.json`)
- [ ] Check results stored in agent run
- [ ] Failed checks → agent run marked with warnings

**Arch docs:** `architecture/agent-platform.md` (Step 7: Validate)

---

## Phase 3 Acceptance Criteria
- `am` CLI connects to same DB as Electron, all commands work
- Can manage full task lifecycle from CLI
- Can start/stop agents from CLI
- Cursor and Aider agents work if installed
- Custom agents configurable via CLI template
- Agent config merges correctly (global → project → run)
- Supervisor auto-detects dead agents
- Project validation runs post-agent
