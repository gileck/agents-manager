# Implementation Plan: Shared/Cross-Cutting Architecture Fixes

**Review:** `docs/architecture-review/08-shared-cross-cutting.md`
**Current Score:** 6.8 / 10
**Target Score:** ~9 / 10
**Priority Order:** logic > docs > bugs > tests > code quality

---

## Phase 1: Bug Fixes (P1)

### Item 1: Fix `calculateCost()` model matching
**File:** `src/shared/cost-utils.ts`
**Complexity:** Small

Replace exact-match lookup with substring matching. Convert `MODEL_PRICING` to pattern-based array:
```typescript
const MODEL_PRICING_TABLE = [
  { pattern: 'opus',   pricing: { inputPerMTok: 15,   outputPerMTok: 75 } },
  { pattern: 'sonnet', pricing: { inputPerMTok: 3,    outputPerMTok: 15 } },
  { pattern: 'haiku',  pricing: { inputPerMTok: 0.25, outputPerMTok: 1.25 } },
];
```

### Item 2: Fix `AGENT_SEND_MESSAGE` dead code
**File:** `src/main/ipc-handlers.ts` (lines 321-340)
**Complexity:** Small

Move `queueMessage()` before the conditional. Only the `else` branch (start new agent) remains in the `if`.

### Item 3: Add validation to `KANBAN_BOARD_UPDATE`
**File:** `src/main/ipc-handlers.ts` (line 465)
**Complexity:** Small

Add `validateInput(input, [])` to ensure non-null object (all fields optional).

---

## Phase 2: Architecture (P2)

### Item 4: Resolve `ChatSession` type duplication
**Files:** `src/main/interfaces/chat-session-store.ts`, `src/main/interfaces/index.ts`
**Complexity:** Small

Remove local type declarations from interface file. Import from `src/shared/types.ts`. Update barrel to only export `IChatSessionStore`.

### Item 5: Complete the interface barrel
**File:** `src/main/interfaces/index.ts`
**Complexity:** Small

Add exports for `IKanbanBoardStore`, `IChatMessageStore`, `IAgentDefinitionStore`, `IAgentLib`.

### Item 6: Add preload channel sync check
**File:** New `tests/unit/ipc-channel-sync.test.ts`
**Complexity:** Medium

Vitest test that reads preload source as text, asserts all channels from `src/shared/ipc-channels.ts` appear.

### Item 7: Extract complex IPC handlers into domain files
**Files:** `src/main/ipc-handlers.ts` → new `src/main/ipc-handlers/telegram-handlers.ts`, `shell-handlers.ts`, `git-handlers.ts`
**Complexity:** Medium

Extract ~230 lines into 3 domain files. Each exports `register*Handlers(services)`. Main file shrinks from ~955 to ~600 lines.

---

## Phase 3: Documentation (P3)

### Item 8: Rewrite `docs/ipc-and-renderer.md`
**Complexity:** Medium

Update channel count to ~107. Add all missing domains (Chat, Kanban, Telegram, etc.), push events, preload constraint docs, shared utilities docs, interface conventions.

### Item 9: Add unit tests for shared utilities
**Files:** New `tests/unit/cost-utils.test.ts`, `phase-utils.test.ts`, `agent-message-utils.test.ts`
**Complexity:** Medium

Test all pure functions: `calculateCost`, `formatCost`, `formatTokens`, `getActivePhase`, `hasPendingPhases`, `messagesToRawText`.

### Item 10: Clarify `FeatureStatus`/`Feature` relationship
**File:** `src/shared/types.ts`
**Complexity:** Small

Add JSDoc explaining `FeatureStatus` is computed (not persisted), used only in `FeatureWithProgress`.

### Item 11: Document `IUserStore` intent
**File:** `src/main/interfaces/user-store.ts`
**Complexity:** Small

Add JSDoc noting it's internal-only, not exposed via IPC, reserved for future multi-user.

---

## Phase 4: Quick Wins (P4)

### Item 12: Deduplicate `SETTINGS_UPDATE` read-back
**File:** `src/main/ipc-handlers.ts`
**Complexity:** Small

Extract `readCurrentSettings()` helper used by both GET and UPDATE handlers.

### Item 13: Add versioned model pricing entries
**File:** `src/shared/cost-utils.ts`
**Complexity:** Small (after Item 1)

Add comment block documenting pricing and update strategy.

---

## Implementation Order

| Step | Items | Dependencies |
|------|-------|-------------|
| 1 (parallel) | Items 1, 2, 3 | None |
| 2 (parallel) | Items 4, 5, 10, 11, 12 | None |
| 3 (parallel) | Items 6, 9, 13 | Item 1 |
| 4 | Item 7 | Items 2, 3, 12 |
| 5 | Item 8 | Items 6, 7 |
