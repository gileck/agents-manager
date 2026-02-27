# Architecture Review: UI Layer (Electron + CLI)

**Date:** 2026-02-27 (Round 2 re-review)
**Component:** Electron Renderer, CLI, Preload Bridge, IPC Handlers
**Previous Score: 8.1 / 10**
**Updated Score: 8.8 / 10**

## Files Reviewed

- `src/preload/index.ts` (482 lines)
- `src/shared/ipc-channels.ts` (172 lines, 8 push-only JSDoc annotations)
- `src/main/ipc-handlers/index.ts` (79 lines) -- barrel registering 12 domain handler groups
- `src/main/ipc-handlers/task-handlers.ts` (205 lines) -- tasks, events, activity, prompts, artifacts, context, debug, worktree, dashboard, workflow review
- `src/main/ipc-handlers/project-handlers.ts` (30 lines)
- `src/main/ipc-handlers/feature-handlers.ts` (30 lines)
- `src/main/ipc-handlers/agent-def-handlers.ts` (42 lines)
- `src/main/ipc-handlers/pipeline-handlers.ts` (14 lines)
- `src/main/ipc-handlers/agent-handlers.ts` (54 lines)
- `src/main/ipc-handlers/chat-session-handlers.ts` (157 lines)
- `src/main/ipc-handlers/git-handlers.ts` (137 lines)
- `src/main/ipc-handlers/kanban-handlers.ts` (58 lines)
- `src/main/ipc-handlers/settings-handlers.ts` (49 lines)
- `src/main/ipc-handlers/shell-handlers.ts` (65 lines)
- `src/main/ipc-handlers/telegram-handlers.ts` (97 lines)
- `src/renderer/App.tsx`, pages (20 routes), hooks (25 files)
- `src/renderer/hooks/useTaskPolling.ts` (52 lines, new)
- `src/renderer/hooks/useActiveAgentRuns.ts` (107 lines, updated)
- `src/renderer/pages/TaskDetailPage.tsx` (854 lines)
- `src/cli/index.ts`, `src/cli/commands/*.ts` (9 command files)
- `tests/unit/ipc-channel-sync.test.ts`

---

## Round 2 Changes Implemented

### 1. Extracted `useTaskPolling` hook (Plan 01, Issue B)

A new `src/renderer/hooks/useTaskPolling.ts` (52 lines) encapsulates the 3-second polling interval and the completion-edge flush that were previously inline in `TaskDetailPage.tsx`. The hook accepts a typed `Refetchers` interface, handles interval cleanup via `useEffect` return, and uses a `useRef` for the previous-running-agent edge detection. `TaskDetailPage.tsx` now calls `useTaskPolling(id, shouldPoll, hasRunningAgent, { ... })` at line 104. The page dropped from ~870 to 854 lines.

### 2. Fixed `useActiveAgentRuns` silent error swallowing (Plan 01, Issue D)

`src/renderer/hooks/useActiveAgentRuns.ts` now:
- Exposes `error` state via `useState<string | null>(null)` (line 12)
- Clears error on successful fetch start: `setError(null)` (line 34)
- Sets error on outer fetch failure: `setError(String(err))` (line 61)
- Inner catches (task title fetch at line 28, finished-run fetch at line 47) log via `console.debug` instead of silently swallowing
- Returns `error` in the hook's return object (line 105)

### 3. Deleted orphaned `HomePage.tsx` (Plan 01, Issue C)

`src/renderer/pages/HomePage.tsx` has been deleted. Zero references remain anywhere in `src/`. The orphaned template artifact is fully removed.

### 4. IPC handler barrel fully decomposed (Plan 08, Issue A)

The `index.ts` barrel went from 411 lines to 79 lines. Five additional handler groups were extracted:
- `task-handlers.ts` (205 lines) -- tasks, events, activity, prompts, artifacts, context, debug timeline, worktree, workflow review, dashboard
- `project-handlers.ts` (30 lines)
- `feature-handlers.ts` (30 lines)
- `agent-def-handlers.ts` (42 lines) -- includes agent lib operations
- `pipeline-handlers.ts` (14 lines)

The barrel now only retains item CRUD (5 handlers from template) and `APP_GET_VERSION`, then delegates to 12 domain registration functions. All domain files follow the same `registerXxxHandlers(services: AppServices)` pattern with proper `validateId`/`validateInput` calls.

### 5. Push-only JSDoc annotations added (Plan 08)

Eight `/** PUSH-ONLY: main->renderer, do not invoke() */` annotations added to `src/shared/ipc-channels.ts` on channels that are main-to-renderer push events: `NAVIGATE`, `AGENT_OUTPUT`, `AGENT_INTERRUPTED_RUNS`, `AGENT_MESSAGE`, `AGENT_STATUS`, `TELEGRAM_BOT_LOG`, `CHAT_OUTPUT`, `CHAT_MESSAGE`.

---

## Round 2 Remaining Issues

### Issue A -- `task-handlers.ts` Bundles Multiple Domains (Low)

At 205 lines, `task-handlers.ts` groups 10 conceptually distinct handler groups: task CRUD, transitions, dependencies, events, activity, prompts, artifacts, context entries, debug timeline, worktree, workflow review, and dashboard stats. While each handler is small and the file is well-organized with section comments, the file name suggests "task" but it owns event, activity, prompt, artifact, dashboard, and worktree handlers too. A further split into `event-handlers.ts`, `dashboard-handlers.ts`, etc. would improve discoverability but is not urgent at this size.

### Issue B -- Telegram Handler Module-Scoped Mutable State (Design Observation)

`telegram-handlers.ts` maintains an `activeBots` Map and a `quitListenerRegistered` flag at module scope (lines 13, 16). This is the only handler file with mutable module-level state. It works correctly and has a double-registration guard, but the pattern couples lifecycle management to the handler registration module rather than to a dedicated service. This is a minor design asymmetry, not a bug.

### Issue C -- TaskDetailPage Remains Large (Low)

At 854 lines, `TaskDetailPage.tsx` is still the largest renderer page. The polling extraction helped, but the file still contains significant inline JSX for multiple dialogs (reset, bug report), tab management, and derived state computation. Further extraction of dialog components or tab content panels could improve readability but is cosmetic at this point.

---

## Quality Ratings

| Dimension | Round 1 | Round 2 | Notes |
|-----------|:-------:|:-------:|-------|
| Modularity | 9 | 9.5 | 13 handler files, clean domain split, barrel is now 79 lines |
| Low Coupling | 8 | 8.5 | Renderer fully isolated via `window.api`; push-only JSDoc clarifies channel directionality |
| High Cohesion | 8 | 8.5 | Domain handler files are tightly cohesive; `task-handlers.ts` is slightly broad |
| Clear and Constrained State | 7 | 8 | `useActiveAgentRuns` error state explicit; `useTaskPolling` encapsulates interval refs |
| Deterministic Behavior | 7 | 7.5 | Polling hooks have clean lifecycle; edge detection uses ref correctly |
| Explicit Dependency Structure | 8 | 8.5 | Preload sync test, push-only annotations, typed Refetchers interface |
| Observability | 7 | 8 | `console.debug` replaces silent catches; error state surfaced to consumers |
| Robust Error Handling | 8 | 9 | All three catch blocks in `useActiveAgentRuns` now produce observable output |
| Simplicity of Structure | 8 | 9 | Barrel is minimal; dead code removed; polling logic extracted |
| Performance Characteristics | 7 | 7 | No change; polling at 3s intervals is acceptable |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 -- Business logic stays in WorkflowService; handlers are pure delegation + validation; hooks encapsulate side effects |
| **Bugs** | 9/10 -- All previous issues fixed; remaining items are design observations, not bugs |
| **Docs** | 9/10 -- Both docs comprehensive and accurate; push-only annotations improve channel contract clarity |
| **Code Quality** | 9/10 -- Consistent patterns across all 13 handler files; hooks are well-typed with proper cleanup |

**Overall: 8.8 / 10** (up from 8.1)

The UI layer is now well-structured with clean separation of concerns. The IPC handler monolith is fully decomposed into focused domain files. Renderer hooks properly encapsulate polling, error state, and lifecycle management. The three issues identified in the Plan 01 gap analysis (polling extraction, silent error swallowing, dead code) have all been addressed. Remaining issues are minor: one handler file (`task-handlers.ts`) could be further split, and the Telegram handler has an unusual but functional lifecycle pattern. The score stops short of 9.0 due to the broad `task-handlers.ts` scope and the still-large `TaskDetailPage.tsx`.
