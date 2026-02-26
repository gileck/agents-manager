# Architecture Review: Shared / Cross-Cutting

**Date:** 2026-02-26 (re-review)
**Component:** Shared types, IPC channels, preload bridge, utilities, interfaces, IPC handlers
**Previous Score: 6.8 / 10**
**Updated Score: 8.1 / 10**

## What Was Fixed

1. **`calculateCost()` always missed model** — Fixed: pattern-based substring matching via `findPricing()`, `MODEL_PRICING_TABLE` array with ordered family patterns.
2. **`AGENT_SEND_MESSAGE` dead code** — Fixed: `agent-handlers.ts:46-53` delegates to `workflowService.resumeAgent()`.
3. **`KANBAN_BOARD_UPDATE` no validation** — Fixed: `validateInput(input, [])` checks non-null object.
4. **`ChatSession` type duplicated** — Fixed: re-exported from `shared/types` as backward-compatible alias.
5. **Interface barrel incomplete** — Fixed: all 28 interfaces exported.
6. **`FeatureStatus` lacked JSDoc** — Fixed: explains computed vs persisted.
7. **`IUserStore` lacked JSDoc** — Fixed: documents internal-only intent.
8. **`SETTINGS_UPDATE` duplicated field extraction** — Fixed: `readCurrentSettings()` shared helper.
9. **Monolithic `ipc-handlers.ts`** — Fixed: split into 7 domain files.
10. **Zero tests for shared utilities** — Fixed: 50 new tests across 4 files.
11. **`docs/ipc-and-renderer.md` outdated** — Fixed: accurately lists all 107 channels.

## Remaining Issues

1. **Push-only channels not marked in `ipc-channels.ts`** (Low) — 8 channels have no handler; developer could attempt `invoke()` and get silent hang.
2. **`validateInput(input, [])` leaves enum fields unchecked** (Low) — Kanban `sortBy`, `sortDirection`, `cardHeight` accept invalid values silently.
3. **`MODEL_PRICING_TABLE` cannot distinguish versioned tiers** (Low) — Three family patterns only.
4. **IPC barrel index still handles 16 domains inline** (Low) — Task handlers (~100 lines) are largest remaining inline block.
5. **Shared utilities have no documentation entry** (Low) — `cost-utils`, `phase-utils`, `agent-message-utils` are implemented and tested but not in any doc.

## Quality Ratings

| Dimension | Prev | Now | Notes |
|-----------|:----:|:---:|-------|
| Modularity | 7 | 8 | IPC split into 7 domain files, barrel complete (28/28) |
| Low Coupling | 7 | 8 | `ChatSession` type dedup eliminates drift risk |
| High Cohesion | 6 | 7 | Shared utilities in dedicated files |
| Clear and Constrained State | 8 | 8 | `TASK_UPDATE` strips status, chat derives projectId |
| Deterministic Behavior | 6 | 9 | `calculateCost()` correctly matches via substring |
| Explicit Dependency Structure | 8 | 9 | Complete 28-interface barrel |
| Observability | 7 | 7 | No change |
| Robust Error Handling | 6 | 8 | Chat session handlers strongest in codebase |
| Simplicity of Structure | 6 | 8 | 955-line monolith eliminated |
| Performance Predictability | 7 | 8 | `readCurrentSettings()` shared helper |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 — `calculateCost()` fixed, all handler logic correct |
| **Bugs** | 8/10 — No active bugs; enum validation and pricing versioning are future risk |
| **Docs** | 8/10 — 107 channels documented; shared utilities undocumented |
| **Code Quality** | 8/10 — Consistent validation patterns, clean helper extraction |

**Overall: 8.1 / 10** (up from 6.8)
