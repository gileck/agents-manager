# Data Layer Improvement Plan

**Review:** `docs/architecture-review/05-data-layer.md`
**Current Score:** 7.5 / 10
**Target Score:** ~9 / 10
**Priority Order:** logic > docs > bugs > tests > code quality

---

## Item 1 (P1): Fix stale `chat-session-store.test.ts`

**Severity:** Critical -- test provides zero coverage
**Complexity:** Medium
**File:** `tests/unit/chat-session-store.test.ts` (full rewrite)

The test calls non-existent methods (`listSessionsForProject`, `createSession({ projectId })`) that were replaced by `listSessionsForScope` and `createSession({ scopeType, scopeId, name })` in migrations 071-073.

**Rewrite to cover:**
- `createSession` with project scope and task scope
- `getSession` / return null for non-existent
- `listSessionsForScope` for both scope types
- `updateSession` (name and agentLib)
- `deleteSession`
- Error handling

Use production migrations via `applyMigrations(db)` instead of inline DDL.

---

## Item 2 (P1): Wrap `deleteFeature()` in a transaction

**Severity:** Critical -- data corruption risk
**Complexity:** Small
**File:** `src/main/stores/sqlite-feature-store.ts` (lines 86-91)

Wrap the UPDATE (unlink tasks) + DELETE (remove feature) in `this.db.transaction()`, following the pattern in `sqlite-task-store.ts`.

---

## Item 3 (P2): Update `docs/data-layer.md`

**Complexity:** Medium
**File:** `docs/data-layer.md`

- Change migration count from "40+" to 73
- Add 4 missing tables: `users`, `kanban_boards`, `project_chat_sessions`, `chat_messages`
- Add 4 missing store files: `sqlite-kanban-board-store.ts`, `sqlite-user-store.ts`, `sqlite-chat-session-store.ts`, `sqlite-chat-message-store.ts`
- Note legacy `items`/`logs` tables

Run `yarn build:claude` after.

---

## Item 4 (P2): Add `limit` parameter to Activity/Event log queries

**Complexity:** Small
**Files:**
- `src/shared/types.ts` -- add `limit?: number` to `ActivityFilter` and `TaskEventFilter`
- `src/main/stores/sqlite-activity-log.ts` -- apply `LIMIT` clause (default 5000)
- `src/main/stores/sqlite-task-event-log.ts` -- apply `LIMIT` clause (default 5000)

---

## Item 5 (P3): Rewrite `getDefinitionByMode()` to use SQL `json_each()`

**Complexity:** Small
**File:** `src/main/stores/sqlite-agent-definition-store.ts` (lines 56-65)

Replace full-table-scan + JS filter with:
```sql
SELECT ad.* FROM agent_definitions ad
WHERE EXISTS (
  SELECT 1 FROM json_each(ad.modes) je
  WHERE json_extract(je.value, '$.mode') = ?
)
LIMIT 1
```

Existing test at `tests/e2e/agent-definition-crud.test.ts:60` validates this.

---

## Item 6 (P3): Document and expose LIMIT 1000 in `getAllRuns()`

**Complexity:** Small
**Files:**
- `src/main/interfaces/agent-run-store.ts` -- add optional `limit` parameter with JSDoc
- `src/main/stores/sqlite-agent-run-store.ts` -- accept `limit` parameter (default 1000)

---

## Item 7 (P3): Move scope-to-projectId derivation out of store

**Complexity:** Medium
**Files:**
- `src/main/interfaces/chat-session-store.ts` -- add `projectId` to `ChatSessionCreateInput`
- `src/main/stores/sqlite-chat-session-store.ts` -- use `input.projectId` directly
- `src/main/ipc-handlers.ts` -- compute `projectId` before calling store

---

## Quick Win (P4): Drop legacy tables

Add migration 074 to drop `items` and `logs` tables. Remove `Item`/`ItemCreateInput`/`ItemUpdateInput` types from `src/shared/types.ts`.

---

## Implementation Order

| Phase | Items | Rationale |
|-------|-------|-----------|
| 1 (parallel) | Items 2, 5, 6, 3 | Independent, no deps |
| 2 | Items 1, 4 | Test rewrite + types change |
| 3 | Item 7 | Depends on Item 1 (same interface) |
| 4 | Drop legacy tables | Lowest priority |

---

## Expected Score Impact

| Item | Dimension | Impact |
|------|-----------|--------|
| 1 | Test coverage, Correctness | +0.5 |
| 2 | Error Handling, State | +0.3 |
| 3 | Documentation | +0.3 |
| 4 | Performance | +0.2 |
| 5 | Performance | +0.2 |
| 6 | API clarity | +0.1 |
| 7 | Modularity, Coupling | +0.1 |

**Projected: ~9.0 / 10**
