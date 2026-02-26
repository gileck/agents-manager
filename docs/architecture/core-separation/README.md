# Core Separation Architecture

## Goal

Separate all business logic into a **long-running daemon process** that owns the database, runs agents, and exposes an API. All UI interfaces (Electron, Web, CLI) become thin clients that connect to the daemon in the same way.

Key requirements:
1. Agents continue running even when UIs are closed
2. Multiple UIs can connect/disconnect freely
3. Any UI can be replaced without touching business logic
4. CLI, Web, and Electron all use the same API to talk to the daemon

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              agents-manager daemon                    │
│                  (always running)                     │
│                                                      │
│  ┌─────────────────────────────────────────────┐     │
│  │              src/core/                       │     │
│  │  agents, services, stores, pipelines,        │     │
│  │  handlers, migrations, config                │     │
│  │  (pure Node.js — zero Electron deps)         │     │
│  └─────────────────────────────────────────────┘     │
│                       │                              │
│  ┌─────────────────────────────────────────────┐     │
│  │              src/daemon/                     │     │
│  │  HTTP REST API  +  WebSocket streaming       │     │
│  │  owns SQLite DB, supervisors, agent runs     │     │
│  └─────────────────────────────────────────────┘     │
│                       │                              │
│          localhost:PORT (HTTP + WS)                   │
└──────────────────────────────────────────────────────┘
         │                  │                │
    ┌────┴────┐       ┌────┴────┐      ┌────┴────┐
    │Electron │       │  Web UI │      │   CLI   │
    │  app    │       │(browser)│      │(terminal│
    │         │       │         │      │  cmds)  │
    └─────────┘       └─────────┘      └─────────┘
    thin client       thin client      thin client
    (same API)        (same API)       (same API)
```

## What the Daemon Owns

Everything that is NOT UI:
- **SQLite database** — single writer, no locking conflicts
- **Agent execution** — long-running processes that survive UI restarts
- **Supervisors** — ghost run detection, workflow review scheduling
- **Telegram bot** — runs independently of any UI
- **Pipeline engine** — state machine, guards, hooks
- **All services** — WorkflowService, AgentService, ChatAgentService, etc.
- **Settings/config** — stored in DB, served via API

## What UIs Own

Nothing except presentation:
- **Electron** — desktop window, tray icon, native notifications, desktop shell commands (open in VS Code/iTerm)
- **Web UI** — browser-based React app (could reuse renderer components)
- **CLI** — terminal output, Commander.js command parsing

All three call the same REST + WebSocket API.

## API Protocol: HTTP REST + WebSocket

**Why REST + WebSocket:**
- Universal — works from Electron (fetch), web browser (fetch), CLI (fetch), even curl
- WebSocket handles real-time streaming (agent output, chat, status updates)
- No code generation or special tooling needed
- Simple to debug and test

See [api-design.md](./api-design.md) for the full API specification.

## Implementation Strategy

The refactor is split into **4 incremental PRs**:

| PR | What | Outcome |
|----|------|---------|
| **PR 1** | Decouple Electron imports from business logic | All business logic files are pure Node.js |
| **PR 2** | Move files to `src/core/` | Clean `core/` directory with zero Electron deps |
| **PR 3** | Build the daemon server (`src/daemon/`) | Daemon runs independently, exposes REST + WS API |
| **PR 4** | Convert Electron + CLI to thin clients | All UIs use the daemon API instead of direct imports |

Each PR leaves the app fully functional.

See [implementation-plan.md](./implementation-plan.md) for detailed steps.
See [coupling-analysis.md](./coupling-analysis.md) for the current dependency audit.
See [api-design.md](./api-design.md) for the daemon API specification.
