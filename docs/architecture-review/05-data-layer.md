# Architecture Review: Data Layer

**Date:** 2026-02-26
**Component:** Data Layer (SQLite Stores + Migrations)
**Overall Score: 7.5 / 10**

## Files Reviewed

- All 17 files in `src/main/stores/`
- `src/main/migrations.ts` (73 migrations)
- `src/main/data/seeded-pipelines.ts`
- All store interfaces in `src/main/interfaces/`
- `tests/helpers/test-context.ts`, `tests/e2e/data-integrity.test.ts`, `tests/unit/chat-session-store.test.ts`

---

## 1. Summary of Findings

The data layer is one of the strongest parts of the codebase. It follows a uniform store pattern across all 17 store files, every query is parameterized (zero SQL injection risk), `parseJson()` is used consistently for safe JSON deserialization, and transactions are correctly applied to most multi-statement operations.

Main weaknesses:
- Documentation significantly out of date (describes 12 stores and "40+" migrations; actual: 17 stores, 73 migrations)
- One stale unit test tests a non-existent API
- `deleteFeature()` is not wrapped in a transaction
- Two store methods perform unbounded reads without LIMIT
- `getDefinitionByMode()` does a full table scan with in-process JSON filtering

---

## 2. Doc Sufficiency Assessment

**Score: 5/10**

| Area | Status |
|------|--------|
| High-level architecture (WAL, pragmas, path resolution) | Good |
| Table inventory | Partial — missing `users`, `kanban_boards`, `project_chat_sessions`, `chat_messages` (final schema) |
| Store file listing | Stale — documents 12; actual is 17 |
| Migration strategy | Good |
| Migration count | Stale — claims "40+"; actual is 73 |
| JSON storage convention | Good |
| API between stores and services | Thin |
| Edge cases | Good |

---

## 3. Implementation vs Docs Gaps

### Undocumented Tables

| Table | Added in | Purpose |
|-------|----------|---------|
| `users` | migration 069 | User accounts with admin/user roles |
| `kanban_boards` | migration 064 | Kanban board configurations per project |
| `project_chat_sessions` | migration 066 | Chat sessions with scope-type support |
| `chat_messages` (final schema) | migration 067 | Session-scoped chat messages |

### Undocumented Store Files

- `sqlite-kanban-board-store.ts`
- `sqlite-user-store.ts`
- `sqlite-chat-session-store.ts`

### Chat Session Interface Drift

The `IChatSessionStore` interface defines `listSessionsForScope(scopeType, scopeId)` and `createSession({ scopeType, scopeId, name })`. But the unit test calls `store.listSessionsForProject('project-1')` and `store.createSession({ projectId: ... })` — methods that no longer exist.

---

## 4. Bugs and Issues Found

### Bug 1 — Stale Unit Test for ChatSessionStore (High Severity)

**File:** `tests/unit/chat-session-store.test.ts`

The test calls `store.listSessionsForProject()` and `store.createSession({ projectId })`, but neither method exists on the current `SqliteChatSessionStore`. The interface was refactored in migrations 071–073. The test provides zero coverage of the real implementation.

### Bug 2 — `deleteFeature()` Is Not Transactional (Medium Severity)

**File:** `src/main/stores/sqlite-feature-store.ts`, lines 86–91

Two SQL statements (unlink tasks, delete feature) are not wrapped in a transaction. A crash between them leaves a zombie feature record. All other multi-statement operations in the codebase correctly use `db.transaction()`.

**Fix:** Wrap in `this.db.transaction(() => { ... })()`.

### Issue 3 — `getDefinitionByMode()` Full Table Scan (Low-Medium)

**File:** `src/main/stores/sqlite-agent-definition-store.ts`, lines 56–65

Loads all agent definitions and filters in JavaScript. Should use SQL `json_each()` (the same technique already used in `listTasks()` for tag filtering).

### Issue 4 — `getAllRuns()` Hardcoded LIMIT 1000 (Low)

**File:** `src/main/stores/sqlite-agent-run-store.ts`, line 154

Undocumented cap. Callers receiving 1000 results have no way to know whether more exist.

### Issue 5 — Unbounded Reads on Log Tables (Low-Medium)

**Files:** `sqlite-activity-log.ts:93`, `sqlite-task-event-log.ts:85`

`getEntries()` and `getEvents()` have no LIMIT clause. Will load entire table into memory on long-running systems.

### Issue 6 — Legacy Tables (Informational)

`items` and `logs` tables are framework template leftovers with no store class or service references.

---

## 5. Quality Ratings

| Dimension | Score | Rationale |
|-----------|:-----:|-----------|
| **Modularity** | 9 | Each table has exactly one store class and one interface. Stores don't call other stores (except justified TaskStore → PipelineStore dependency). |
| **Low Coupling** | 8 | Stores depend only on `Database` and shared types. One cross-store dependency injected via interface. |
| **High Cohesion** | 9 | Each store file is responsible for exactly one table domain. |
| **Clear and Constrained State** | 7 | CHECK constraints enforce enums at SQL level. JSON columns are schema-free. `parseJson()` silently returns defaults on invalid JSON (safe but hides corruption). |
| **Deterministic Behavior** | 8 | All queries parameterized and synchronous. `Date.now()` not injectable in tests. |
| **Explicit Dependency Structure** | 9 | Constructor injection of `Database` throughout. No global singletons. |
| **Observability** | 4 | No query-level logging, no timing instrumentation, no row-count metrics. Slow queries leave no trace. |
| **Robust Error Handling** | 6 | 2 stores wrap operations in try/catch with descriptive rethrows; 15 stores let exceptions propagate raw. `deleteFeature()` non-transaction is the most significant gap. |
| **Simplicity of Structure** | 9 | The row-interface → conversion-function → store-class pattern is applied identically across all 17 stores. |
| **Performance Predictability** | 6 | Most paths O(1) or indexed. Exceptions: `getDefinitionByMode()` O(N×M) in JS; `getEntries()`/`getEvents()` unbounded; LIMIT 1000 implicit. |

**Overall: 7.5 / 10**

---

## 6. Action Items (Prioritized)

### P1 — Critical (Correctness)

1. **Fix stale `chat-session-store.test.ts`** — rewrite to use `listSessionsForScope()` and `createSession({ scopeType, scopeId, name })`
2. **Wrap `deleteFeature()` in a transaction** — add `db.transaction()` around the UPDATE + DELETE

### P2 — High (Documentation / Correctness)

3. **Update `docs/data-layer.md`** — add 5 missing tables, 3 missing store files, update migration count to 73+
4. **Add `limit` parameter to `ActivityFilter` and `TaskEventFilter`** — prevent unbounded reads

### P3 — Medium (Performance / Maintainability)

5. **Rewrite `getDefinitionByMode()` to use SQL `json_each()`**
6. **Document and expose the LIMIT 1000 in `getAllRuns()`**
7. **Move scope-to-projectId derivation out of `SqliteChatSessionStore`** into the service layer

### P4 — Low (Polish)

8. **Standardize error-handling style across stores** (try/catch with descriptive rethrows vs raw propagation)
9. **Consider dropping legacy `items` and `logs` tables**
10. **Add query-level observability** (timing hooks on `db.prepare().run/get/all`)
