# Architecture Review: Pipeline Engine (State Machine)

**Date:** 2026-02-27 (Round 2 re-review)
**Component:** Pipeline Engine
**Previous Score: 9.1 / 10**
**Updated Score: 9.4 / 10**

## Round 2 Changes Implemented

All three items from Plan 03 have been addressed:

1. **JSDoc on `executeForceTransition`** — A clear JSDoc block (lines 274-284) now documents that required-hook failures are intentionally non-fatal for force transitions. The comment explicitly contrasts this behavior with `executeTransition`, noting that force transitions are an administrative override where hook failures are logged but do not block the operation or trigger rollback.

2. **`.catch(() => {})` replaced with `console.error` fallback** — All audit log `.catch` handlers now use `.catch((err) => console.error('Audit log write failed:', err))`. Zero silent-swallow sites remain. This covers 5 call sites: guard-failure event log (line 212), unregistered hook log (line 499), hook failure log (line 531), hook throw log (line 544), and rollback-failure log (line 591).

3. **Guard-failure `transition_history` row inserted** — When guards block a transition, a `transition_history` record with `{ _denied: true, guardFailures }` is now inserted inside the synchronous transaction (lines 178-191), before the early return. This completes the audit trail so every transition attempt — successful, rolled back, or denied — produces a history row.

## Round 2 Remaining Issues

1. **`fire_and_forget` hook error logging is nested** (Info) — The `fire_and_forget` path (line 505) catches hook errors and calls `taskEventLog.log()`, but the inner `.catch` on that log call is absent. If the audit log write itself fails after a fire-and-forget hook error, the rejection is unhandled. Extremely low risk since fire-and-forget hooks are non-critical by definition, but adding a `.catch(console.error)` on the inner log call would be fully consistent with the other sites.

2. **No integration test for denied `transition_history` rows** (Info) — The new guard-failure history insertion is correct in code, but there is no dedicated test asserting that a `transition_history` row with `_denied: true` exists after a guard blocks a transition. Adding one would lock in the behavior.

## Quality Ratings

| Dimension | R1 | R2 | Notes |
|-----------|:--:|:--:|-------|
| Modularity | 9 | 9 | Guards, hooks, pipelines all external |
| Low Coupling | 8 | 8 | Four injected interfaces |
| High Cohesion | 9 | 9 | Engine orchestrates; helpers handle sub-steps |
| Clear and Constrained State | 9 | 9 | TOCTOU on both execute paths |
| Deterministic Behavior | 8 | 8 | Routing disambiguation solid |
| Explicit Dependency Structure | 9 | 9 | Constructor injection throughout |
| Observability | 9 | 10 | All transition attempts now produce history rows; no silent catches |
| Robust Error Handling | 9 | 9 | Transactional rollback with compensating history |
| Simplicity of Structure | 9 | 9 | Clean helper extraction, 594 lines, 6+3 methods |
| Performance Characteristics | 8 | 8 | Synchronous SQLite transaction bounded |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 — Routing, disambiguation, rollback, and force-transition semantics all correct |
| **Bugs** | 10/10 — No active bugs; all previous info-level items resolved |
| **Docs** | 10/10 — JSDoc on force transition documents the intentional design asymmetry |
| **Code Quality** | 9/10 — Consistent error handling, clear helper separation, one minor fire-and-forget nit |

**Overall: 9.4 / 10** (up from 9.1)
