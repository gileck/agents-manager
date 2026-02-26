# Implementation Plan: Agent System Architecture Fixes

**Review:** `docs/architecture-review/04-agent-system.md`
**Current Score:** 7.6 / 10
**Target Score:** ~9 / 10
**Priority Order:** logic > docs > bugs > tests > code quality

---

## Phase A: Critical Logic Fixes (P1) -- Do First

### Item 1: Fix `Agent.isAvailable()` -- delegate to configured engine

**File:** `src/main/agents/agent.ts` (lines 129-137)
**Complexity:** Small

Add `defaultEngine` parameter to constructor (defaults to `'claude-code'`). Use `this.libRegistry.getLib(this.defaultEngine)` in `isAvailable()` instead of hardcoded `'claude-code'`. Update registration in `src/main/providers/setup.ts`.

### Item 2: Raise supervisor timeout above implement mode timeout

**File:** `src/main/services/agent-supervisor.ts` (line 15 and lines 60-62)
**Complexity:** Small

Use per-run `run.timeoutMs` from DB (already populated by 3s flush). Compute: `effectiveTimeout = (run.timeoutMs ?? defaultTimeoutMs) + 5min grace`. Raise `defaultTimeoutMs` from 15min to 35min as fallback.

### Item 3: Forward all callbacks in validation retry

**File:** `src/main/services/agent-service.ts` (line 613)
**Complexity:** Small (one line)

Change line 613 to include `onPromptBuilt` and `wrappedOnMessage` callbacks (already in scope).

### Item 4: Add `'review'` to read-only mode guard

**File:** `src/main/agents/base-agent-prompt-builder.ts` (line 55)
**Complexity:** Small (one line)

Add `|| context.mode === 'review'` to the `isReadOnlyMode` condition.

---

## Phase B: Logic Fix (P2 code change)

### Item 10: Fix `AgentFrameworkImpl.listAgents()` hardcoded `available: false`

**File:** `src/main/services/agent-framework-impl.ts` (line 22)
**Complexity:** Small

Change `available: false` to `available: true` (optimistic default). The async `getAvailableAgents()` does the real check. Add JSDoc explaining the optimistic default.

---

## Phase C: Documentation (P2)

### Item 5: Update prompt template resolution path
**File:** `docs/agent-system.md` | **Complexity:** Small

Replace stale `context.resolvedPrompt` code sample with actual flow: `modeConfig?.promptTemplate` → `PromptRenderer.render()` → fallback `resolvedPrompt` → `buildPrompt()`.

### Item 6: Document `PromptRenderer` with all template variables
**File:** `docs/agent-system.md` | **Complexity:** Small

Document all 13 template variables (`{taskTitle}`, `{taskDescription}`, `{subtasksSection}`, etc.), auto-appended summary behavior, and validation error handling.

### Item 7: Remove `src/main/agents/prompts/` reference
**File:** `docs/agent-system.md` frontmatter | **Complexity:** Small

Replace with: "Prompt templates: DB-backed via PromptRenderer, or hardcoded in prompt builder classes". Run `yarn build:claude` after.

### Item 8: Document `ChatAgentService`
**File:** `docs/agent-system.md` | **Complexity:** Medium

Document: two execution paths (Direct SDK vs AgentLib), agent lib resolution order, history injection, scope resolution, summarize flow, running agent tracking.

### Item 9: Document `AgentSupervisor` and `SandboxGuard`
**File:** `docs/agent-system.md` | **Complexity:** Medium

Document supervisor (poll interval, ghost run detection, timeout detection) and sandbox guard (allowed paths, tool evaluation, sensitive paths, fail-closed).

### Item 14: Note CLI backend token-count limitation
**File:** `docs/agent-system.md` | **Complexity:** Small

Add bullet noting CLI backend always returns 0 for token counts.

---

## Phase D: Quick-Win Tests (P3)

### Item 13: Add unit tests for `ImplementorPromptBuilder`

**File:** New `tests/unit/implementor-prompt-builder.test.ts`
**Complexity:** Medium

Test all 13 modes, `getMaxTurns()`, `getTimeout()`, `getOutputFormat()`, `inferOutcome()`, phase-aware display, validation errors.

---

## Implementation Order

| Step | Items | Effort |
|------|-------|--------|
| 1 | Items 1-4 (P1 logic fixes, parallel) | ~1-2 hours |
| 2 | Item 10 (listAgents fix) | ~15 min |
| 3 | Items 5-9, 14 (documentation) | ~3-4 hours |
| 4 | Item 13 (tests) | ~2-3 hours |

**Total: ~7-10 hours**

**Deferred:** Item 11 (route ChatAgentService through ClaudeCodeLib -- large refactor), Item 12 (extract SubtaskSyncService).
