# Plan 05: Data Layer (8.6 → 9+)

## Gap Analysis

- **14 stores lack consistent error handling** — Most public methods have no try/catch, unlike `sqlite-kanban-board-store.ts` which wraps everything
- **`getMessagesForSession()` has no limit** — Unbounded query could return massive result sets
- **Legacy `items` and `logs` tables still exist** — Dead schema from earlier iterations
- **`project_chat_sessions` table naming** — Inconsistent with other table names (no `project_` prefix pattern)

## Changes

### 1. Wrap all 14 stores with consistent error handling

**Files:** All 14 store files in `src/main/stores/` that don't already have try/catch wrapping

Apply try/catch with `console.error` + descriptive rethrow to every public method, matching the pattern in `sqlite-kanban-board-store.ts`:
```ts
try {
  // existing logic
} catch (err) {
  console.error('StoreName.methodName failed:', err);
  throw err;
}
```

### 2. Add `limit` to `getMessagesForSession()`

**Files:** `src/main/stores/sqlite-chat-message-store.ts`, `src/main/interfaces/chat-message-store.ts`

- Add `limit?: number` parameter (default 5000) to interface and implementation
- Add SQL `LIMIT ?` clause

### 3. Drop legacy `items` and `logs` tables

**File:** `src/main/migrations.ts`

Add two additive migrations at the end:
```sql
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS logs;
```

### 4. Rename `project_chat_sessions` → `chat_sessions`

**Files:** `src/main/migrations.ts`, `src/main/stores/sqlite-chat-session-store.ts`

- Add `ALTER TABLE project_chat_sessions RENAME TO chat_sessions` migration
- Update all SQL strings in `sqlite-chat-session-store.ts`

## Files to Modify

| File | Action |
|------|--------|
| 14 store files in `src/main/stores/` | Edit (add error handling) |
| `src/main/stores/sqlite-chat-message-store.ts` | Edit (add limit) |
| `src/main/interfaces/chat-message-store.ts` | Edit (add limit param) |
| `src/main/migrations.ts` | Edit (add 3 migrations) |
| `src/main/stores/sqlite-chat-session-store.ts` | Edit (rename table) |

## Complexity

Medium-Large (~4 hours, mostly repetitive wrapping)
