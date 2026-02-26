# Architecture Review: UI Layer (Electron + CLI)

**Date:** 2026-02-26
**Component:** Electron Renderer, CLI, Preload Bridge
**Overall Score: 7.2 / 10**

## Files Reviewed

- `src/renderer/App.tsx`, pages (21 routes), hooks (23 files), components
- `src/cli/index.ts`, `src/cli/commands/*.ts`, `src/cli/db.ts`, `src/cli/context.ts`
- `src/preload/index.ts` (483 lines)
- `src/shared/ipc-channels.ts` (85+ channels)
- `src/main/ipc-handlers.ts` (954 lines)
- `docs/ipc-and-renderer.md`, `docs/cli-reference.md`, `docs/development-guide.md`

---

## 1. Summary of Findings

The UI layer is well-structured with clean separation of concerns. Both UIs (Electron renderer + CLI) correctly delegate all logic to `WorkflowService`. IPC channels are type-safe, the preload bridge is comprehensive, and error handling is solid.

However, documentation is significantly behind: ~40% of IPC channels, 7 renderer pages, 15+ hooks, and entire feature areas (Chat, Kanban, Telegram, SourceControl) are undocumented.

---

## 2. Doc Sufficiency Assessment

### `docs/ipc-and-renderer.md`

| Item | Documented | Actual |
|------|-----------|--------|
| IPC channel count | "57+" | 85+ |
| Pages listed | 14 | 21 routes |
| Hooks listed | 8 | 23 hooks |
| Push event listeners | 2 | 7 |
| Sidebar nav items | 7 | 12 |

**Missing pages (7):** ChatPage, TelegramPage, CostPage, SourceControlPage, KanbanBoardPage, ThemePage, ProjectConfigPage

**Missing channel groups:** Chat (8), Chat Sessions (5), Kanban (6), Agent Lib (2), Shell (3), Telegram (5), Source Control (3), Pipeline Diagnostics (7), new Agent channels (4)

**Missing hooks (15):** useChat, useChatSessions, useActiveAgents, useKanbanBoard, useKanbanDragDrop, useKanbanKeyboardShortcuts, useKanbanMultiSelect, useVirtualizedKanban, useGitLog, useHookRetry, usePipelineDiagnostics, usePipelineStatusMeta, useLocalStorage, useRouteRestore, useThemeConfig

### `docs/cli-reference.md`

- `telegram` command group undocumented
- DB close mechanism description incorrect (says `process.on('exit')`, actual is `.finally()`)
- No mention subtask commands bypass WorkflowService

---

## 3. Bugs and Issues Found

### Bug 1 — Preload Channel Duplication Has No Sync Guard (Structural)

**File:** `src/preload/index.ts:37-146`

85+ channel strings duplicated from `src/shared/ipc-channels.ts`. No compile-time or test-time sync assertion. Adding a channel to one file without the other is a silent runtime failure.

### Bug 2 — `AGENT_SEND_MESSAGE` Handler Has Identical Branches (Low)

**File:** `src/main/ipc-handlers.ts:321-340`

Both `if (running)` and `else` branches call `queueMessage()` identically. The conditional adds no behavioral difference for the queue call.

### Bug 3 — Preload `chatSession.create` Cannot Set `agentLib` (Low)

**File:** `src/preload/index.ts:411`

Preload signature takes `(scopeType, scopeId, name)` but IPC handler accepts `agentLib?`. Sessions can only have `agentLib` set via a separate `update` call.

### Bug 4 — CLI `agent runs` Without `--task` Shows Active-Only (Low)

**File:** `src/cli/commands/agent.ts:47-53`

Falls back to `getActiveRuns()` when no filter given. Historical runs inaccessible without `--task`. No `--all` option exists.

### Bug 5 — CLI Subtask Commands Bypass WorkflowService (Low)

**File:** `src/cli/commands/tasks.ts:301, 320, 339, 364`

All subtask mutations call `taskStore.updateTask` directly — no activity logging or events emitted.

### Issue 6 — Polling Proliferation in TaskDetailPage (Low-Medium)

**File:** `src/renderer/pages/TaskDetailPage.tsx:103-114`

6 IPC calls every 3 seconds when `shouldPoll` is true, plus sidebar and task list polling. Up to 8+ concurrent polling intervals during agent runs.

### Issue 7 — `HomePage.tsx` is Orphaned Template Artifact

Not routed in `App.tsx` but still exists and compiles. Contains template infrastructure code (`window.api.items.list()`).

---

## 4. Quality Ratings

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| **Modularity** | 8 | Pages, hooks, components, contexts well-separated. `ipc-handlers.ts` (954 lines) is a monolith. |
| **Low Coupling** | 8 | Renderer fully isolated via `window.api`. CLI uses composition root. No business logic in either UI. |
| **High Cohesion** | 7 | Most hooks well-scoped. `TaskDetailPage` (870 lines) handles too many concerns. |
| **Clear and Constrained State** | 7 | `CurrentProjectContext` is the only global state. `__force_refresh__` string-as-signal is a weak pattern. |
| **Deterministic Behavior** | 7 | IPC request/response deterministic. 30-second `isFinalizing` heuristic is time-dependent. |
| **Explicit Dependency Structure** | 7 | `window.api` boundary explicit. Preload duplication is an implicit hidden dependency. |
| **Observability** | 7 | ErrorBoundary catches render errors. Toast notifications for agent failures. Polling errors silently swallowed. |
| **Robust Error Handling** | 7 | Most IPC errors caught and surfaced. `validateId`/`validateInput` on all handlers. Silent swallowing in polling hooks. |
| **Simplicity of Structure** | 7 | Architecture conceptually simple. `TaskDetailPage` and `ipc-handlers.ts` push complexity boundaries. |
| **Performance Predictability** | 7 | Polling intervals bounded. CLI `status` has O(T) prompt aggregation. |

**Overall: 7.2 / 10**

---

## 5. Action Items (Prioritized)

### P1 — Documentation

1. **Update `docs/ipc-and-renderer.md`** — correct channel count to 85+, add 7 missing pages, 15 missing hooks, all missing channel groups, fix push listener count, correct sidebar nav count
2. **Update `docs/cli-reference.md`** — add `telegram` commands, fix DB close description, note subtask bypass

### P2 — Code Quality

3. **Fix `AGENT_SEND_MESSAGE` handler** — remove redundant identical branch or differentiate behavior
4. **Expose `agentLib` in preload `chatSession.create`**
5. **Add `--all` flag to CLI `agent runs`**

### P3 — Structural

6. **Add build-time preload channel sync assertion** — prevent silent drift
7. **Split `ipc-handlers.ts` (954 lines)** into domain-scoped handler files
8. **Extract `TaskDetailPage` polling** into `useTaskPolling` hook

### P4 — Test Coverage

9. **Add renderer component tests** — CurrentProjectContext, useChat, useActiveAgentRuns
10. **Add full CLI command tests** exercising `program.parseAsync()`

### P5 — Cleanup

11. Remove orphaned `HomePage.tsx`
12. Surface polling errors in `useActiveAgentRuns`
