# Architecture Review: WorkflowService (Orchestration)

**Date:** 2026-02-26 (re-review)
**Component:** WorkflowService
**Previous Score: 6.8 / 10**
**Updated Score: 8.3 / 10**

## What Was Fixed

1. **Dead code in `updateTask` removed** — The unreachable `sameNameStatus` branch is gone. Status fallback is a direct assignment inside the `!statusExists` guard.
2. **`resumeAgent` moved into WorkflowService** — `AGENT_SEND_MESSAGE` handler is now a clean three-line delegation. All business logic lives in `WorkflowService.resumeAgent()`.
3. **`getDashboardStats` uses SQL aggregation** — `ITaskStore` now exposes `getTotalCount()` and `getStatusCounts()`. All five queries parallelized via `Promise.all`.
4. **Injectable clock in `getDashboardStats`** — `now?: number` parameter for testability.
5. **Required constructor dependencies** — `createGitOps` and `taskContextStore` are now positional required parameters.
6. **`getPipelineDiagnostics` parallelized** — Three independent store reads run concurrently.
7. **`mergePR` error handling standardized** — Every path returns `TransitionResult`. No code path throws.
8. **`advancePhase` failure paths log to event log** — Both failure branches log with `severity: 'warning'`.
9. **All interface methods documented** — All 15 public methods fully documented in `docs/workflow-service.md`.
10. **`AppServices` interface matches code** — `docs/architecture-overview.md` lists all members correctly.

## Remaining Issues

1. **`advancePhase` has a redundant two-search structure with an activity log gap** (Low) — Fallback success path returns without calling `activityLog.log`.
2. **Unnamed 30-second magic constant in `getPipelineDiagnostics`** (Low) — Should be `AGENT_FINALIZATION_GRACE_MS`.
3. **File length approaching extraction threshold** (Low) — 725 lines, 15 public methods. Pipeline inspection methods are natural extraction candidates.

## Quality Ratings

| Dimension | Prev | Now | Notes |
|-----------|:----:|:---:|-------|
| Modularity | 6 | 7 | 725 lines, 15 public methods |
| Low Coupling | 7 | 8 | 14 constructor deps, all interface-typed, all required |
| High Cohesion | 6 | 7 | Core lifecycle methods cohesive |
| Clear and Constrained State | 8 | 8 | No mutable instance state |
| Deterministic Behavior | 7 | 8 | `getDashboardStats` clock injectable |
| Explicit Dependency Structure | 8 | 9 | All deps required, factory pattern documented |
| Observability | 8 | 8 | Activity log on every mutation (one gap) |
| Robust Error Handling | 6 | 9 | `mergePR` standardized, `advancePhase` logs failures |
| Simplicity of Structure | 6 | 7 | Core CRUD clean; `advancePhase` two-search adds load |
| Performance Predictability | 6 | 9 | SQL aggregation, parallelized diagnostics |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 — Dead code removed, business-logic leak sealed |
| **Bugs** | 8/10 — Activity-log gap in `advancePhase` fallback |
| **Docs** | 9/10 — All 15 methods documented with full semantics |
| **Code Quality** | 7/10 — Cleaner; `advancePhase` search logic needs simplification |

**Overall: 8.3 / 10** (up from 6.8)
