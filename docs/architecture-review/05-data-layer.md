# Architecture Review: Data Layer

**Date:** 2026-02-26 (re-review)
**Component:** Data Layer (SQLite Stores + Migrations)
**Previous Score: 7.5 / 10**
**Updated Score: 8.6 / 10**

## What Was Fixed

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

## Remaining Issues

1. **Error-handling style inconsistent** (Low-Medium) — 2 stores wrap with descriptive rethrow, 14 propagate raw `SqliteError`.
2. **`getMessagesForSession()` has no LIMIT** (Info) — Could accumulate unbounded rows.
3. **Legacy `items` and `logs` tables** (Info) — Template artifacts, no store class.
4. **`project_chat_sessions` table name misleading** (Info) — Holds both project and task-scoped sessions.

## Quality Ratings

| Dimension | Prev | Now | Notes |
|-----------|:----:|:---:|-------|
| Modularity | 9 | 9 | Each table maps to one store class and interface |
| Low Coupling | 8 | 8 | Constructor injection; `projectId` derivation in IPC layer |
| High Cohesion | 9 | 9 | Each store owns exactly one table domain |
| Clear and Constrained State | 7 | 8 | `deleteFeature()` transactional |
| Deterministic Behavior | 8 | 8 | All queries parameterized and synchronous |
| Explicit Dependency Structure | 9 | 9 | No global singletons |
| Observability | 4 | 4 | No query-level logging |
| Robust Error Handling | 6 | 7 | Two stores wrap consistently; 14 do not |
| Simplicity of Structure | 9 | 9 | Identical pattern across all 16 stores |
| Performance Predictability | 6 | 8 | SQL `json_each()`, configurable LIMIT on reads |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 — Transaction gap closed, incorrect query fixed |
| **Bugs** | 8/10 — No correctness bugs; error handling inconsistent |
| **Docs** | 9/10 — Accurate for migration count, all tables, all stores |
| **Code Quality** | 9/10 — Type duplication resolved, barrel complete |

**Overall: 8.6 / 10** (up from 7.5)
