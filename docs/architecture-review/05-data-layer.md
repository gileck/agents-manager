# Architecture Review: Data Layer

**Date:** 2026-02-27 (Round 2 re-review)
**Component:** Data Layer (SQLite Stores + Migrations)
**Previous Score: 8.6 / 10**
**Updated Score: 9.2 / 10**

## Round 1 What Was Fixed

1. **`chat-session-store.test.ts` completely rewritten** — 17 tests covering all 5 CRUD methods, both scope types, `agentLib` set/clear, edge cases, and error-path coverage.
2. **`deleteFeature()` wrapped in transaction** — `sqlite-feature-store.ts:87` executes UPDATE + DELETE inside `db.transaction()`.
3. **`docs/data-layer.md` brought up to date** — 73 migrations, 20 tables, 16 store files mapped.
4. **`limit` parameter added to `ActivityFilter` and `TaskEventFilter`** — Default 5000, applied as SQL LIMIT.
5. **`getDefinitionByMode()` rewritten to SQL `json_each()`** — Correlated subquery pushes filtering into SQLite.
6. **`getAllRuns()` limit documented and exposed** — JSDoc on interface, default 1000.
7. **`projectId` derivation moved out of store** — IPC handler resolves `projectId` before calling store. Store is pure persistence.
8. **Interface barrel exports completed** — All 17 interfaces exported.
9. **Type duplication resolved** — `ChatSession` types canonical in `shared/types.ts`.
10. **`FeatureStatus` JSDoc added** — Documents it is computed, not persisted.

## Round 2 Changes Implemented

1. **All 16 stores now have consistent error handling** — Every public method across all 16 `sqlite-*-store.ts` files is wrapped in try/catch with `console.error('StoreName.methodName failed:', err)` and rethrow. Verified in `sqlite-task-store.ts`, `sqlite-activity-log.ts`, `sqlite-pipeline-store.ts`, `sqlite-agent-run-store.ts`, `sqlite-user-store.ts`, `sqlite-pending-prompt-store.ts`, `sqlite-chat-message-store.ts`, and others. Total of 84 `console.error` call sites across all 16 stores.
2. **`getMessagesForSession()` now has a LIMIT** — `IChatMessageStore` interface updated with `limit?: number` parameter. `SqliteChatMessageStore` implementation applies `LIMIT ?` in SQL with default of 5000. Prevents unbounded result sets.
3. **Legacy `items` and `logs` tables dropped** — Migration `074_drop_legacy_items_logs_tables` executes `DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS logs`. Template artifacts removed.
4. **`project_chat_sessions` renamed to `chat_sessions`** — Migration `075_rename_project_chat_sessions_to_chat_sessions` executes `ALTER TABLE project_chat_sessions RENAME TO chat_sessions`. `SqliteChatSessionStore` updated throughout to use `chat_sessions` table name. Total migration count is now 75.

## Round 2 Remaining Issues

1. **Error rethrow style varies slightly** (Low) — 14 stores use `throw err` (re-throw original), while 2 stores (`sqlite-kanban-board-store.ts`, `sqlite-chat-session-store.ts`) wrap with `throw new Error(...)` containing a descriptive message. Both patterns include `console.error` logging before the throw. This is a cosmetic inconsistency; both approaches are defensible and all errors are logged.
2. **No query-level observability** (Low) — Stores log errors but not successful queries. For a desktop app this is acceptable, but a debug-level SQL logger would aid troubleshooting. Not a priority.

## Quality Ratings

| Dimension | R1 | R2 | Notes |
|-----------|:--:|:--:|-------|
| Modularity | 9 | 9 | Each table maps to one store class and interface |
| Low Coupling | 8 | 8 | Constructor injection; `projectId` derivation in IPC layer |
| High Cohesion | 9 | 9 | Each store owns exactly one table domain |
| Clear and Constrained State | 8 | 9 | `deleteFeature()` transactional; legacy tables dropped; table renamed |
| Deterministic Behavior | 8 | 9 | All queries parameterized, synchronous, and bounded by LIMIT |
| Explicit Dependency Structure | 9 | 9 | No global singletons |
| Observability | 4 | 6 | All 16 stores now log errors consistently; no debug query logging |
| Robust Error Handling | 7 | 9 | All 16 stores: try/catch + console.error + rethrow on every method |
| Simplicity of Structure | 9 | 9 | Identical pattern across all 16 stores |
| Performance Predictability | 8 | 9 | `json_each()`, configurable LIMIT on all unbounded reads |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 — All identified correctness issues resolved across both rounds |
| **Bugs** | 9/10 — No correctness bugs; all error paths handled consistently |
| **Docs** | 9/10 — Accurate for 75 migrations, all tables, all stores mapped |
| **Code Quality** | 9/10 — Type duplication resolved, barrel complete, schema cleaned up |

**Overall: 9.2 / 10** (up from 8.6)
