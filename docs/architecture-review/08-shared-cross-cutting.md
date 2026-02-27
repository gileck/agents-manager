# Architecture Review: Shared / Cross-Cutting

**Date:** 2026-02-27 (Round 2 re-review)
**Component:** Shared types, IPC channels, preload bridge, utilities, interfaces, IPC handlers
**Previous Score: 8.1 / 10**
**Updated Score: 8.8 / 10**

## Round 2 Changes Implemented

All five items from Plan 08 were completed:

1. **IPC handler barrel extraction (Plan item 1)** — Five new handler files extracted from the monolithic `index.ts`: `task-handlers.ts` (29 handlers), `project-handlers.ts` (5), `feature-handlers.ts` (5), `agent-def-handlers.ts` (7, including agent-lib), `pipeline-handlers.ts` (2). The barrel `index.ts` is now 79 lines and delegates via `register*Handlers()` calls. Total handler files: 13, spread across 1017 lines.

2. **Push-only JSDoc on 8 IPC channels (Plan item 2)** — All 8 push-only channels now carry `/** PUSH-ONLY: main->renderer, do not invoke() */` annotations in `src/shared/ipc-channels.ts`: NAVIGATE, AGENT_OUTPUT, AGENT_INTERRUPTED_RUNS, AGENT_MESSAGE, AGENT_STATUS, TELEGRAM_BOT_LOG, CHAT_OUTPUT, CHAT_MESSAGE. This prevents developers from accidentally calling `invoke()` on main-to-renderer-only channels.

3. **Kanban enum validation (Plan item 3)** — `kanban-handlers.ts` now defines `VALID_SORT_BY`, `VALID_SORT_DIRECTION`, and `VALID_CARD_HEIGHT` constant tuples and validates all three fields in `validateKanbanEnums()` before passing input to the store. Invalid values produce clear error messages listing allowed options.

4. **Versioned pricing tiers (Plan item 4)** — `cost-utils.ts` `MODEL_PRICING_TABLE` now includes three versioned entries (`claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-3-haiku`) before the generic family patterns. The ordering is correct: specific entries first, generic fallbacks last, so `claude-3-5-sonnet-20241022` matches the versioned entry rather than the generic `sonnet` fallback.

5. **Shared utilities documentation (Plan item 5)** — New `docs/shared-utilities.md` documents all exports for `cost-utils.ts`, `phase-utils.ts`, and `agent-message-utils.ts` with exports tables and a description of the pricing tier evaluation strategy.

## Round 2 Remaining Issues

1. **`task-handlers.ts` is a catch-all (205 lines, 29 handlers)** (Low) — Despite the plan targeting ~15 task handlers, the file also registers handlers for events (EVENT_LIST), activity (ACTIVITY_LIST), prompts (PROMPT_LIST, PROMPT_RESPOND), artifacts (ARTIFACT_LIST), task context entries, debug timeline, worktree, workflow review, and dashboard stats. DASHBOARD_STATS in particular has no relation to tasks. These non-task handlers (~80 lines, 10 handlers) could be extracted into a separate `misc-handlers.ts` or further domain-specific files to improve cohesion.

2. **No Claude 4 versioned pricing entries** (Low) — The codebase default model is `claude-opus-4-6` and lists `claude-sonnet-4-6` as an option, but the pricing table has no versioned entries for Claude 4 models. They fall back to generic family patterns (`opus` at $15/$75, `sonnet` at $3/$15), which may not reflect current Claude 4 pricing. Adding `claude-sonnet-4` and `claude-opus-4` entries would future-proof accuracy.

3. **`shared-utilities.md` not referenced in auto-generated CLAUDE.md** (Trivial) — The new documentation file exists but is not linked from the project's CLAUDE.md. This is expected since CLAUDE.md is auto-generated via `yarn build:claude`, but the build script's source list may need updating to include it.

4. **Kanban enum validation tuples are handler-local** (Trivial) — The `VALID_SORT_BY`, `VALID_SORT_DIRECTION`, and `VALID_CARD_HEIGHT` tuples are defined in `kanban-handlers.ts` rather than co-located with the `KanbanBoardUpdateInput` type in `shared/types`. If the renderer needs to validate these values (e.g., for dropdowns), it must duplicate them.

## What Was Fixed (Round 1, retained for history)

1. **`calculateCost()` always missed model** — Fixed: pattern-based substring matching via `findPricing()`, `MODEL_PRICING_TABLE` array with ordered family patterns.
2. **`AGENT_SEND_MESSAGE` dead code** — Fixed: `agent-handlers.ts:46-53` delegates to `workflowService.resumeAgent()`.
3. **`KANBAN_BOARD_UPDATE` no validation** — Fixed: `validateInput(input, [])` checks non-null object.
4. **`ChatSession` type duplicated** — Fixed: re-exported from `shared/types` as backward-compatible alias.
5. **Interface barrel incomplete** — Fixed: all 28 interfaces exported.
6. **`FeatureStatus` lacked JSDoc** — Fixed: explains computed vs persisted.
7. **`IUserStore` lacked JSDoc** — Fixed: documents internal-only intent.
8. **`SETTINGS_UPDATE` duplicated field extraction** — Fixed: `readCurrentSettings()` shared helper.
9. **Monolithic `ipc-handlers.ts`** — Fixed: split into 7 domain files (Round 1), then 5 more extracted (Round 2) for 13 total.
10. **Zero tests for shared utilities** — Fixed: 50 new tests across 4 files.
11. **`docs/ipc-and-renderer.md` outdated** — Fixed: accurately lists all 107 channels.

## Quality Ratings

| Dimension | R1 | R2 | Notes |
|-----------|:--:|:--:|-------|
| Modularity | 8 | 9 | 13 handler files; barrel is 79 lines; only task-handlers.ts remains overloaded |
| Low Coupling | 8 | 8 | No change; handler files import only their own types |
| High Cohesion | 7 | 8 | Handler groups well-scoped; task-handlers.ts still a mild catch-all |
| Clear and Constrained State | 8 | 8 | No change; TASK_UPDATE strips status, chat derives projectId |
| Deterministic Behavior | 9 | 9 | Kanban enum validation eliminates silent bad-value passthrough |
| Explicit Dependency Structure | 9 | 9 | 28-interface barrel; push-only annotations prevent misuse |
| Observability | 7 | 7 | No change |
| Robust Error Handling | 8 | 9 | Kanban enum validation with descriptive error messages; consistent validateId/validateInput |
| Simplicity of Structure | 8 | 9 | Clean barrel pattern; each domain file self-contained with clear section headers |
| Performance Predictability | 8 | 8 | No change |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 — All handler logic correct; calculateCost matches versioned entries first |
| **Bugs** | 9/10 — No active bugs; missing Claude 4 pricing is cosmetic inaccuracy |
| **Docs** | 9/10 — 8 push-only channels documented; shared-utilities.md covers all three utility modules |
| **Code Quality** | 9/10 — Consistent validation patterns; clean modular structure with clear naming |

**Overall: 8.8 / 10** (up from 8.1)
