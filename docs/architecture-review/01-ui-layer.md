# Architecture Review: UI Layer (Electron + CLI)

**Date:** 2026-02-26 (re-review)
**Component:** Electron Renderer, CLI, Preload Bridge, IPC Handlers
**Previous Score: 7.2 / 10**
**Updated Score: 8.1 / 10**

## Files Reviewed

- `src/preload/index.ts` (483 lines)
- `src/shared/ipc-channels.ts` (164 lines, 106 channels)
- `src/main/ipc-handlers/index.ts` (411 lines) — barrel + items, projects, tasks, pipelines, events, activity, prompts, artifacts, features, agent defs, agent libs, worktree, dashboard, workflow review
- `src/main/ipc-handlers/agent-handlers.ts` (55 lines)
- `src/main/ipc-handlers/chat-session-handlers.ts` (157 lines)
- `src/main/ipc-handlers/git-handlers.ts` (138 lines)
- `src/main/ipc-handlers/kanban-handlers.ts` (38 lines)
- `src/main/ipc-handlers/settings-handlers.ts` (50 lines)
- `src/main/ipc-handlers/shell-handlers.ts` (65 lines)
- `src/main/ipc-handlers/telegram-handlers.ts` (97 lines)
- `src/renderer/App.tsx`, pages (20 routes), hooks (23 files)
- `src/cli/index.ts`, `src/cli/commands/*.ts` (9 command files)
- `tests/unit/ipc-channel-sync.test.ts`
- `docs/ipc-and-renderer.md`
- `docs/cli-reference.md`

---

## 1. What Was Fixed Since the Previous Review

### P1 — Documentation (Completed)

**`docs/ipc-and-renderer.md`** was fully rewritten. The previous version documented "57+" channels, 14 pages, 8 hooks. The rewritten version now correctly documents 107 channels, all 20 routed pages, all 23 hooks with return shapes, all 8 push event channels, the handler split architecture with a domain file table, and six edge cases.

**`docs/cli-reference.md`** was fully rewritten with the `telegram` command group, correct DB close mechanism, subtask bypass documentation, `--all` flag, and three-step project context resolution order.

### P2 — Code Quality (Completed)

**Preload `chatSession.create` now accepts `agentLib`** (`src/preload/index.ts:411`). The IPC handler validates the lib name against the registry.

**CLI `agent runs --all` flag added** (`src/cli/commands/agent.ts:44`). All three retrieval modes available: `--all`, `--active`, `--task <id>`.

### P3 — Structural (Completed)

**IPC handler monolith split into domain files.** The 954-line `ipc-handlers.ts` monolith decomposed into 8 files. Each domain file imports only the IPC channels it uses and receives only the `AppServices` subset it needs.

**Preload channel sync test added** (`tests/unit/ipc-channel-sync.test.ts`). Three assertions enforcing channel alignment between shared definitions and preload source.

---

## 2. Remaining Issues

### Issue A — `index.ts` Barrel Still Owns ~14 Handler Groups Directly (Low)

At 411 lines, the barrel still directly implements handlers for items, projects, tasks, pipelines, events, activity, prompts, artifacts, features, agent definitions, agent libs, worktree, dashboard, and workflow review. Lower-priority split.

### Issue B — `TaskDetailPage` Polling Not Extracted (Low-Medium)

`src/renderer/pages/TaskDetailPage.tsx:103-114` fires 6 IPC calls every 3 seconds. A dedicated `useTaskPolling` hook was not created. File remains ~870 lines.

### Issue C — `HomePage.tsx` Orphaned Template Artifact (Very Low)

Not routed in `App.tsx`. Dead code from the Electron template infrastructure.

### Issue D — Silent Error Swallowing in `useActiveAgentRuns` (Low)

`fetchData()` catches all errors with an empty catch block. Polling failures silently discarded.

### Issue E — Telegram Handler Creates Lifecycle State Inside Registration Function (Design Observation)

`registerTelegramHandlers()` creates a `Map` and `before-quit` listener inside the function body. Works correctly but is an unusual hybrid of registration and state ownership.

---

## 3. Quality Ratings

| Dimension | Previous | Current | Notes |
|-----------|:--------:|:-------:|-------|
| Modularity | 8 | 9 | Handler split eliminates the 954-line monolith |
| Low Coupling | 8 | 8 | Renderer fully isolated via `window.api` |
| High Cohesion | 7 | 8 | Domain handler files are tightly cohesive |
| Clear and Constrained State | 7 | 7 | No change |
| Deterministic Behavior | 7 | 7 | No change |
| Explicit Dependency Structure | 7 | 8 | Preload sync test makes channel contract explicit |
| Observability | 7 | 7 | No change |
| Robust Error Handling | 7 | 8 | Shell/git/telegram/chat handlers have strong validation |
| Simplicity of Structure | 7 | 8 | Handler split is the largest structural simplification |
| Performance Characteristics | 7 | 7 | No change |

| Category | Score |
|----------|:-----:|
| **Logic** | 8/10 — Business logic stays in WorkflowService; handlers are pure delegation + validation |
| **Bugs** | 8/10 — Previous bugs fixed; remaining are low-severity edge cases |
| **Docs** | 9/10 — Both docs comprehensive and accurate |
| **Code Quality** | 8/10 — Consistent `registerIpcHandler` + validation pattern across all handlers |

**Overall: 8.1 / 10** (up from 7.2)
