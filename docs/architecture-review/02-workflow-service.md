# Architecture Review: WorkflowService (Orchestration)

**Date:** 2026-02-26
**Component:** WorkflowService
**Overall Score: 6.8 / 10**

## Executive Summary

WorkflowService is a well-structured orchestration layer that successfully enforces activity logging, worktree cleanup, and pipeline transitions as cross-cutting concerns. The single-entry-point principle is largely upheld. The main findings are: four public methods are completely undocumented, the AppServices interface in the architecture docs is stale, one dead-code bug exists in `updateTask`, and one business-logic leak is present in the `AGENT_SEND_MESSAGE` IPC handler.

---

## 1. Doc Sufficiency Assessment

### docs/workflow-service.md

| Area | Status |
|------|--------|
| High-level role description | Sufficient |
| Activity logging table | Sufficient |
| Worktree cleanup lifecycle | Sufficient |
| Prompt response / resume flow diagram | Sufficient |
| `createTask` | Documented |
| `updateTask` | Partially — pipeline-switching logic absent |
| `deleteTask` | Documented |
| `resetTask` | Missing optional `pipelineId` param |
| `transitionTask` | Documented |
| `startAgent` | Missing `onMessage`, `onStatusChange` callback params |
| `stopAgent` | Documented |
| `respondToPrompt` | Missing `resumeToStatus` and Q&A context storage |
| `mergePR` | Documented |
| `getDashboardStats` | Documented |
| `forceTransitionTask` | **Not documented** |
| `getPipelineDiagnostics` | **Not documented** |
| `retryHook` | **Not documented** |
| `advancePhase` | **Not documented** |

**Verdict:** 4 of 12 interface methods entirely absent from docs.

### docs/architecture-overview.md

`AppServices` interface is stale — 9 members missing:
`kanbanBoardStore`, `createGitOps`, `agentSupervisor`, `timelineService`, `workflowReviewSupervisor`, `chatMessageStore`, `chatSessionStore`, `chatAgentService`, `agentLibRegistry`

`notificationRouter` typed as `INotificationRouter` in docs but is `MultiChannelNotificationRouter` in code.

---

## 2. Implementation vs Docs Gaps

| Gap | Severity |
|-----|----------|
| `forceTransitionTask` not documented | High |
| `getPipelineDiagnostics` not documented | High |
| `retryHook` not documented | High |
| `advancePhase` not documented | High |
| `resetTask` missing `pipelineId` param | Medium |
| `respondToPrompt` `resumeToStatus` undocumented | Medium |
| `AppServices` interface stale in architecture doc | Medium |
| Phase handler hook missing from architecture doc | Low |

---

## 3. Bugs and Issues Found

### Bug 1 — Dead Code in `updateTask` (Low Severity)

**File:** `src/main/services/workflow-service.ts`, lines 91–107

`Array.some()` and `Array.find()` are called with identical predicate `s.name === existingTask.status`. When `some()` returns `false`, `find()` always returns `undefined`. The `if (sameNameStatus)` branch is unreachable dead code.

**Fix:** Remove the dead branch; simplify to direct fallback.

### Bug 2 — Business Logic Leak in `AGENT_SEND_MESSAGE` IPC Handler (Medium Severity)

**File:** `src/main/ipc-handlers.ts`, lines 321–340

The handler reads `agentRunStore` directly, derives `mode` and `agentType` from historical run data, and conditionally starts a new agent. This is business logic in the presentation layer, violating the single-entry-point principle.

**Fix:** Introduce `WorkflowService.resumeAgent(taskId, message)`.

### Issue 3 — Project CRUD Bypasses WorkflowService (Low, by-design)

`PROJECT_CREATE`, `PROJECT_UPDATE`, `PROJECT_DELETE` call `projectStore` directly. No activity logging. Undocumented exception to the single-entry-point principle.

### Issue 4 — `getDashboardStats` O(n) In-Memory Aggregation (Medium at scale)

All tasks loaded into memory to compute a status histogram. Should be `SELECT status, COUNT(*) GROUP BY status`.

---

## 4. Quality Ratings

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| **Modularity** | 6 | 676 lines, 12 public methods. `getPipelineDiagnostics` (100 lines) and `advancePhase` (55 lines) could be extracted. |
| **Low Coupling** | 7 | 14 constructor deps (all interface-typed). 2 optional deps create nullable-guard complexity. |
| **High Cohesion** | 6 | Core task/agent lifecycle is cohesive. Pipeline inspection methods blur the boundary. |
| **Clear and Constrained State** | 8 | No mutable instance state; all state in SQLite. `forceTransitionTask` is unconstrained power. |
| **Deterministic Behavior** | 7 | `getDashboardStats` embeds `Date.now()` (not injectable). `getPipelineDiagnostics` has hardcoded 30s heuristic. |
| **Explicit Dependency Structure** | 8 | Constructor injection throughout. Optional deps are a minor smell. |
| **Observability** | 8 | Activity log on every mutation. Event log on pipeline changes. No structured request tracing. |
| **Robust Error Handling** | 6 | `cleanupWorktree` correctly swallows errors. `mergePR` throws 3 different ad-hoc errors. `advancePhase` silently returns `{ success: false }`. |
| **Simplicity of Structure** | 6 | Core CRUD is clean. `getPipelineDiagnostics`, `advancePhase`, and `retryHook` are complex. |
| **Performance Predictability** | 6 | `getDashboardStats` is O(n). `getPipelineDiagnostics` runs 4+ queries sequentially (could parallelize). |

**Overall: 6.8 / 10**

---

## 5. Action Items (Prioritized)

### P0 — Correctness

1. **Fix dead code in `updateTask`** (`workflow-service.ts:91–107`). Remove unreachable `sameNameStatus` branch.

### P1 — Documentation

2. **Document `forceTransitionTask`** — when to use it, guard bypass implications
3. **Document `getPipelineDiagnostics`** — stuck detection, hook failure scraping, 30s window
4. **Document `retryHook`** — two-pass search algorithm, retryable hook constraints
5. **Document `advancePhase`** — both code paths (explicit hook vs. fallback system transition)
6. **Update `AppServices` in architecture doc** — add 9 missing members, fix `notificationRouter` type
7. **Document `resetTask(id, pipelineId?)` param**

### P2 — Architecture

8. **Move `AGENT_SEND_MESSAGE` logic into WorkflowService** as `resumeAgent(taskId, message)`
9. **Fix `getDashboardStats`** — SQL aggregation instead of in-memory loop
10. **Make optional deps required** with no-op defaults
11. **Parallelize `getPipelineDiagnostics` queries** with `Promise.all`

### P3 — Consistency

12. **Standardize `mergePR` error handling** — return `TransitionResult` instead of ad-hoc throws
13. **Make `getDashboardStats` time-injectable** for deterministic testing
14. **Document the project CRUD exception** to the single-entry-point principle
15. **Add log entry in `advancePhase` "no system transition" path**
