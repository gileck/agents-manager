# Architecture Review: Shared / Cross-Cutting

**Date:** 2026-02-26
**Component:** Shared types, IPC channels, preload bridge, interfaces
**Overall Score: 6.8 / 10**

## Files Reviewed

- `src/shared/ipc-channels.ts`, `types.ts`, `cost-utils.ts`, `phase-utils.ts`, `agent-message-utils.ts`
- `src/preload/index.ts`
- `src/main/ipc-handlers.ts`
- `src/main/interfaces/` (28 files)
- `src/main/handlers/` (7 files)
- `docs/ipc-and-renderer.md`

---

## 1. Summary of Findings

The shared layer has a solid structural foundation — the `I`-prefix interface convention is consistent, types are centralized in `src/shared/types.ts`, and the IPC layer uses a shared channel registry. However, documentation is severely outdated (~50% of channels documented), there is a silent correctness bug in `calculateCost()`, dead code in `AGENT_SEND_MESSAGE`, and the preload channel duplication has no automated sync verification.

---

## 2. Doc Sufficiency Assessment

`docs/ipc-and-renderer.md` states "57+ IPC channels" — actual count is **~107 channels**.

### Missing entire feature domains from docs:

| Domain | Channels Not Documented |
|--------|------------------------|
| Chat | 6 channels |
| Chat Sessions | 5 channels |
| Telegram | 5 channels |
| Kanban Board | 6 channels |
| Agent Lib | 2 channels |
| Shell | 3 channels |
| Source Control | 3 channels |
| Pipeline Diagnostics | 6 channels |
| Workflow Review | 1 channel |

### Also missing:
- 5 undocumented push channels (`AGENT_MESSAGE`, `AGENT_STATUS`, `CHAT_OUTPUT`, `CHAT_MESSAGE`, `TELEGRAM_BOT_LOG`)
- Preload duplication constraint (Electron sandboxing prevents `require()`)
- Shared utility modules documentation
- Interface naming conventions

---

## 3. Implementation vs Docs Gaps

### Interface barrel incomplete

`src/main/interfaces/index.ts` exports 24 of 27 interfaces. Missing:
- `IKanbanBoardStore`
- `IChatMessageStore`
- `IAgentDefinitionStore`

### Type duplication: `ChatSession`

Defined in both `src/shared/types.ts` and `src/main/interfaces/chat-session-store.ts`. Currently identical but can drift independently.

### `IUserStore` exposed in barrel but has no IPC handlers

Unclear whether internal-only or incomplete feature.

---

## 4. Bugs and Issues Found

### Bug 1 — `calculateCost()` Model Matching Always Misses (Medium Severity)

**File:** `src/shared/cost-utils.ts`, lines 10–29

`MODEL_PRICING` keys are family names (`'sonnet'`, `'opus'`), but `model` values are full IDs (e.g., `claude-sonnet-4-6`). The exact-match lookup `MODEL_PRICING[model]` always fails, silently defaulting to Sonnet pricing for all models including Opus (5x more expensive).

**Fix:** Use substring matching or full model IDs as keys.

### Bug 2 — Dead Code in `AGENT_SEND_MESSAGE` (Low Severity)

**File:** `src/main/ipc-handlers.ts`, lines 321–340

Both branches call `queueMessage()` identically. The conditional adds no differentiation for the queue call.

### Issue 3 — Weak Typing on `KANBAN_BOARD_UPDATE` (Low-Medium)

**File:** `src/main/ipc-handlers.ts`, line 465

`input: unknown` with a cast — no field validation. Other update handlers use `validateInput()`.

### Issue 4 — Preload Channel Duplication: No Sync Verification

**File:** `src/preload/index.ts`, lines 36–146

~107 channel entries manually duplicated. No compile-time enforcement that these stay synchronized with `src/shared/ipc-channels.ts`. Mismatches would be silent runtime failures.

### Issue 5 — `FeatureStatus` Type Declared But Unused on `Feature`

`FeatureStatus` is exported but only used in `FeatureWithProgress`. The `Feature` entity itself has no status field. Creates confusion.

### Issue 6 — No Tests for Shared Utilities

`cost-utils.ts`, `phase-utils.ts`, `agent-message-utils.ts` have zero test coverage. These are pure functions ideal for unit testing.

---

## 5. Quality Ratings

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| **Modularity** | 7 | One channel per concern, one interface per store. The 955-line `ipc-handlers.ts` is a monolith. |
| **Low Coupling** | 7 | `src/shared/types.ts` is the explicit coupling surface. Preload duplication creates maintenance coupling. |
| **High Cohesion** | 6 | `src/shared/types.ts` is 954 lines covering 20+ domains. Organized by headers but grows without bound. |
| **Clear and Constrained State** | 8 | `TASK_UPDATE` handler strips `status` to prevent bypass. Guard checks are synchronous. |
| **Deterministic Behavior** | 6 | `calculateCost()` silently falls back to wrong pricing. Most other utilities are deterministic. |
| **Explicit Dependency Structure** | 8 | Handler deps injected via `AppServices`. Interface files one-per-concept. Composition root is single wiring point. |
| **Observability** | 7 | Agent/git/SCM handlers log to `taskEventLog`. IPC handler layer has no structured logging. |
| **Robust Error Handling** | 6 | Git read ops return `null` on failure (appropriate). `KANBAN_BOARD_UPDATE` accepts `unknown` with no validation. |
| **Simplicity of Structure** | 6 | Preload duplication unavoidable. `ChatSession` type duplication is avoidable. Monolithic `ipc-handlers.ts` grows with features. |
| **Performance Predictability** | 7 | Most handlers are thin DB pass-throughs. `SETTINGS_UPDATE` reads settings twice. |

**Overall: 6.8 / 10**

---

## 6. Action Items (Prioritized)

### P1 — Bugs / Correctness

1. **Fix `calculateCost()` model matching** — change to substring matching or use full model IDs as keys
2. **Fix `AGENT_SEND_MESSAGE` dead code** — remove duplicate `queueMessage()` call
3. **Add validation to `KANBAN_BOARD_UPDATE`** — replace `input: unknown` with typed parameter

### P2 — Architecture / Maintainability

4. **Resolve `ChatSession` type duplication** — delete from interface file, import from `src/shared/types.ts`
5. **Complete the interface barrel** — add `IKanbanBoardStore`, `IChatMessageStore`, `IAgentDefinitionStore`
6. **Add preload channel sync check** — build-time verification or type-level assertion
7. **Extract complex IPC handlers into domain files** — Telegram (~80 lines), shell (~60 lines), git-write handlers

### P3 — Documentation

8. **Rewrite `docs/ipc-and-renderer.md`** — cover all ~107 channels, 7 push channels, preload constraint, utilities, interface conventions
9. **Add unit tests for shared utilities** — `calculateCost()`, `formatCost()`, `getActivePhase()`, `hasPendingPhases()`, `messagesToRawText()`
10. **Clarify `FeatureStatus`/`Feature` relationship** — add JSDoc explaining it's computed, not persisted
11. **Document `IUserStore` intent** — either add IPC handlers or document as internal-only

### P4 — Minor

12. **Deduplicate `SETTINGS_UPDATE` read-back** — extract `readCurrentSettings()` helper
13. **Add versioned model pricing entries** after fixing model matching
