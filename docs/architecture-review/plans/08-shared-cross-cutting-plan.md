# Plan 08: Shared/Cross-cutting (8.1 → 9+)

## Gap Analysis

- **`ipc-handlers/index.ts` is a 411-line monolith** — All handler registrations in one file
- **Push-only IPC channels undocumented** — 8 channels are main→renderer only but nothing marks them
- **Kanban handler lacks enum validation** — `sortBy`, `sortDirection`, `cardHeight` passed through unvalidated
- **`cost-utils.ts` missing versioned model entries** — Only generic family patterns, no specific version entries
- **No documentation for shared utility modules**

## Changes

### 1. Extract 5 handler groups from `index.ts`

**Files:** `src/main/ipc-handlers/task-handlers.ts`, `project-handlers.ts`, `feature-handlers.ts`, `agent-def-handlers.ts`, `pipeline-handlers.ts` (all new), `src/main/ipc-handlers/index.ts`

Extract:
- `task-handlers.ts` (~15 handlers)
- `project-handlers.ts` (5 handlers)
- `feature-handlers.ts` (5 handlers)
- `agent-def-handlers.ts` (5 handlers)
- `pipeline-handlers.ts` (2 handlers)

`index.ts` becomes a barrel that imports and calls each group's `register*Handlers()` function. Target: ~80 lines.

### 2. Add push-only JSDoc to `ipc-channels.ts`

**File:** `src/shared/ipc-channels.ts`

Add comment above each of the 8 push-only channels:
```ts
// PUSH-ONLY: main→renderer, do not invoke()
```

### 3. Add kanban enum validation

**File:** `src/main/ipc-handlers/kanban-handlers.ts`

Validate `sortBy`, `sortDirection`, `cardHeight` against allowed values before passing to store.

### 4. Add versioned pricing tiers

**File:** `src/shared/cost-utils.ts`

Add specific model entries above generic family patterns:
- `claude-3-5-sonnet`
- `claude-3-5-haiku`
- `claude-3-haiku`

### 5. Create `docs/shared-utilities.md`

**File:** `docs/shared-utilities.md` (new)

Document:
- `cost-utils.ts` — exports, pricing tier structure
- `phase-utils.ts` — exports, phase calculation logic
- `agent-message-utils.ts` — exports, message parsing

Include exports table for each module.

## Files to Modify

| File | Action |
|------|--------|
| `src/main/ipc-handlers/task-handlers.ts` | Create |
| `src/main/ipc-handlers/project-handlers.ts` | Create |
| `src/main/ipc-handlers/feature-handlers.ts` | Create |
| `src/main/ipc-handlers/agent-def-handlers.ts` | Create |
| `src/main/ipc-handlers/pipeline-handlers.ts` | Create |
| `src/main/ipc-handlers/index.ts` | Edit (barrel only) |
| `src/shared/ipc-channels.ts` | Edit (add comments) |
| `src/main/ipc-handlers/kanban-handlers.ts` | Edit (add validation) |
| `src/shared/cost-utils.ts` | Edit (add model entries) |
| `docs/shared-utilities.md` | Create |

## Complexity

Medium (~3 hours)
