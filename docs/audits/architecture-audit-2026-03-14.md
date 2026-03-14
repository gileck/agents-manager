# Architecture Audit Report — 2026-03-14

## Summary

- Scopes checked: abstractions, layers, registration, docs
- Total checks run: 12
- Passed: 10
- Failed: 2
- Warnings: 5

---

## Abstraction Integrity

### Check 1: No Direct Implementation Imports — PASS

All checked service, agent, and handler files depend on interfaces, not concrete implementations:

- No sqlite-*.ts imports found in `src/core/services/` (excluding allowed registration points)
- No concrete AgentLib imports (`claude-code-lib`, `cursor-agent-lib`, `codex-cli-lib`, `codex-app-server-lib`) found in services or agents (excluding `agent-lib-registry.ts`)
- No `local-git-ops`, `github-scm-platform`, or `local-worktree-manager` imports found in services or handlers
- No sqlite-*.ts imports found in `src/core/handlers/`

Allowed exceptions verified clean: `src/core/providers/setup.ts` (composition root) and `src/core/services/agent-lib-registry.ts` (AgentLib registry).

### Check 2: Constructor Parameter Types Use Interfaces — PASS

All major service constructors use interface types:

| Service | Key parameters |
|---|---|
| `WorkflowService` | `ITaskStore`, `IProjectStore`, `IPipelineEngine`, `IScmPlatform` factory, `IWorktreeManager` factory, `IGitOps` factory |
| `AgentService` | `IAgentFramework`, `IAgentRunStore`, `IWorktreeManager` factory, `ITaskStore`, `INotificationRouter` |
| `PipelineEngine` | `IPipelineStore`, `ITaskStore`, `ITaskEventLog` |
| `PipelineInspectionService` | `ITaskStore`, `IPipelineEngine`, `IPipelineStore`, `IActivityLog`, `IAgentRunStore` |

All handler registration functions (`registerAgentHandler`, `registerCoreGuards`, etc.) also take interface types as parameters.

### Check 5: No Engine-Specific Code in Agents — PASS

- No imports from `@anthropic-ai/claude-code`, `codex`, `cursor`, or `src/core/libs/` found in `src/core/agents/`
- All prompt builders and the `Agent` class are fully engine-agnostic
- Engine resolution is done at runtime via `AgentLibRegistry`, not hardcoded

### Check 8: Interface Completeness — PASS

All 36 interfaces in `src/core/interfaces/` have at least one implementation. No orphaned interfaces found.

Notable: `INotificationRouter` has 4 implementations (multi-channel, telegram, in-app, stub). `IAgentLib` has 4 implementations (claude-code, cursor, codex-cli, codex-app-server) plus a base class.

### Check 12: Code Duplication — FAIL (1) + WARN (2)

#### FAIL: `resolveSandboxMode` duplicated across two AgentLib implementations

**Locations:**
- `src/core/libs/codex-cli-lib.ts`
- `src/core/libs/codex-app-server-lib.ts`

**Duplicated code** (identical logic in both files):
```typescript
function resolveSandboxMode(
  permissionMode: PermissionMode | undefined,
  readOnly: boolean,
): SandboxMode {
  switch (permissionMode) {
    case 'full_access': return 'danger-full-access';
    case 'read_write': return 'workspace-write';
    case 'read_only': return 'read-only';
    default: return readOnly ? 'read-only' : 'workspace-write';
  }
}
```

**Fix:** Extract to a shared utility file, e.g., `src/core/libs/lib-utils.ts` or `src/core/libs/permission-resolver.ts`, and import it in both files.

#### WARN: Dynamic SQL building pattern in multiple store implementations

The `conditions[]` + `values[]` array pattern for building `WHERE` clauses is copy-pasted across stores: task, feature, task-artifact, task-event-log, in-app-notification, activity-log, app-debug-log stores.

Example pattern:
```typescript
const conditions: string[] = [];
const values: unknown[] = [];
if (filter?.projectId) {
  conditions.push('project_id = ?');
  values.push(filter.projectId);
}
const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
```

**Fix:** Extract a `buildWhereClause(conditions: string[], values: unknown[]): { where: string, values: unknown[] }` helper to `src/core/stores/utils.ts`. Not critical — the pattern is simple and consistent — but reduces repetition across all store files that use it.

#### WARN: Telegram bot services share substantial duplicated code

`TelegramBotService` and `TelegramAgentBotService` (both implementing `ITelegramBotService`) duplicate:
- `PendingAction` type definition (identical)
- Constants: `MAX_INPUT_LENGTH`, `PENDING_ACTION_TTL_MS`, `PENDING_ACTION_CLEANUP_INTERVAL_MS` (identical)
- Pending actions cleanup logic (identical)
- `start()` method structure (very similar)
- Helper methods for logging and error handling

**Fix:** Consider a `BaseTelegramBotService` base class with shared lifecycle, pending actions, and constants. Lower priority — the two services have different command handlers making extraction non-trivial.

---

## Layer Boundary Violations

### Check 3: No Business Logic in Transport Layers — PASS

All transport layers are thin wrappers:

- `src/daemon/routes/` — all route handlers extract parameters and delegate to services
- `src/main/ipc-handlers/` — all handlers delegate to the API client
- `src/cli/index.ts` — pure Commander.js routing; all logic delegated to daemon API client
- `src/web/api-shim.ts` — pure HTTP-to-ApiShape shim; no business logic

### Check 4: No SQLite/DB Imports Outside Stores and Setup — FAIL

Four areas with SQL/DB access outside the allowed store and infrastructure files:

#### FAIL 1: `src/core/services/item-service.ts`

Contains direct `db.prepare()` calls with SQL:
- Line 11: `INSERT` statement
- Line 26: `SELECT` statement
- Line 40: `SELECT` statement
- Line 76: `UPDATE` statement
- Line 82: `DELETE` statement

**Fix:** Move to `src/core/stores/sqlite-item-store.ts`. Create an `IItemStore` interface in `src/core/interfaces/item-store.ts` and register the implementation in `setup.ts`.

#### FAIL 2: `src/core/handlers/core-guards.ts`

Guard functions contain direct `db.prepare()` SQL queries:
- Line 16: Complex `SELECT` for `dependencies_resolved` guard (checking task dependencies)
- Line 39: `SELECT` for `max_retries` guard
- Line 53: `SELECT` for `no_running_agent` guard
- Line 84: `SELECT` for `is_admin` guard

**Context:** Guards must be synchronous — they can't use async store methods. The guard functions receive a raw `Database.Database` instance. This is a design trade-off: guards need synchronous reads that the store interface (which could be async) doesn't guarantee.

**Fix options:**
1. Add synchronous query methods to the relevant store interfaces (`ITaskStore.getSync()`, `IAgentRunStore.getActiveRunSync()`, etc.) — better-sqlite3 already operates synchronously
2. Create a `GuardQueryService` that wraps the db for guard-specific synchronous queries
3. Pre-compute and pass guard data as part of the transition context (avoids DB in guards entirely)

#### FAIL 3: `src/core/services/pipeline-engine.ts`

The `PipelineEngine` contains multiple direct `db.prepare()` SQL calls (9+ occurrences across `getPreviousStatus()`, `executeTransition()`, and related methods — `SELECT`, `INSERT`, and `UPDATE` statements).

**Fix:** Introduce a `ITransitionHistoryStore` (or extend `IPipelineStore`) to encapsulate the transition-history read/write operations. Move the SQL into `sqlite-pipeline-store.ts` or a new `sqlite-transition-history-store.ts`.

#### FAIL 4: `src/core/services/timeline/sources/*.ts` (8 files)

All 8 timeline source files contain direct `db.prepare()` SQL queries:
- `activity-source.ts`, `agent-run-source.ts`, `artifact-source.ts`, `context-source.ts`, `event-source.ts`, `phase-source.ts`, `prompt-source.ts`, `transition-source.ts`

**Fix:** The timeline sources are composable query objects — they could be refactored as:
1. Methods on existing store interfaces (each source queries data owned by a specific store)
2. A single `ITimelineStore` interface with all timeline queries

### Check 6: No Platform-Specific Code in Services — PASS

No raw `git` or `gh` shell commands found in service files that use `IGitOps` or `IScmPlatform`. All platform-specific invocations are properly contained in `local-git-ops.ts`, `github-scm-platform.ts`, and `local-worktree-manager.ts`.

### Check 7: Renderer Does Not Import Core Services — PASS

No value imports from `src/core/` found in `src/renderer/`. All renderer files use `window.api` for service access. Renderer imports only from `src/shared/` for type definitions.

---

## Registration Point Issues

### Check 9: Registration Points Are Pure Wiring — PASS

**`src/core/providers/setup.ts`:** Pure composition root — instantiation, factory assignments, hook registration. No business logic.

**`src/core/services/agent-lib-registry.ts`:** Pure registry — `register()`, `getLib()`, `listNames()`. No business logic.

**Note:** `src/daemon/routes/git.ts` and `src/daemon/routes/telegram.ts` create concrete instances (e.g., `LocalGitOps`, `TelegramAgentBotService`) inside route handlers. These are request-scoped factory patterns — instances are created, used, and discarded within the handler scope. This is acceptable: they are not global registration points but scoped factories.

### Check 10: Registration Points Are Documented — PASS

All primary registration points are documented in `docs/abstractions.md`:
- `src/core/providers/setup.ts` documented as composition root
- `src/core/services/agent-lib-registry.ts` documented in AgentLib section

Request-scoped factories in route handlers (`git.ts`, `telegram.ts`) are not global registration points and do not need documentation in `abstractions.md`.

---

## Documentation Gaps

### Check 11: Documentation Completeness and Accuracy — PASS with WARN

All 17 documented abstractions in `docs/abstractions.md` are accurate:
- All interface file paths exist and define the stated interfaces
- All implementation file paths exist and implement the interfaces
- All registry/factory references exist and wire the abstractions

#### WARN 1: `IAgent` not documented in `docs/abstractions.md`

**File:** `src/core/interfaces/agent.ts`
**Implementations:** `Agent` class, `ScriptedAgent` class
**Impact:** Minor — this is a fundamental internal interface but the docs focus on higher-level separations. Could be worth adding as abstraction #18 for completeness.

#### WARN 2: `ITimelineSource` not documented in `docs/abstractions.md`

**File:** `src/core/services/timeline/types.ts` (or similar)
**Implementations:** 8+ sources (activity-source, agent-run-source, artifact-source, context-source, event-source, phase-source, prompt-source, transition-source)
**Impact:** The timeline source is a complete abstraction pattern but is entirely absent from the architecture docs. Should be added.

#### WARN 3: `in-app-notification-router.ts` not documented

The `InAppNotificationRouter` implementation of `INotificationRouter` is not mentioned in `docs/abstractions.md` — the docs only list `TelegramNotificationRouter` and `StubNotificationRouter`. Update the NotificationRouter section to include it.

---

## Recommendations (Priority Order)

### High Priority (Fix Now)

1. **`item-service.ts` uses raw SQL** — Move to `src/core/stores/sqlite-item-store.ts` with an `IItemStore` interface. This is a clean architectural violation with a straightforward fix.

2. **`pipeline-engine.ts` uses raw SQL** — Introduce a `ITransitionHistoryStore` or extend `IPipelineStore` with transition-history methods. Move SQL to the store implementation.

3. **`resolveSandboxMode` duplicated in codex libs** — Extract to `src/core/libs/lib-utils.ts`.

### Medium Priority (Fix Soon)

4. **`timeline/sources/*.ts` use raw SQL** — Refactor timeline sources as store methods or a new `ITimelineStore`. This will clean up the DB boundary violations.

5. **`core-guards.ts` uses raw SQL** — Evaluate adding synchronous query methods to relevant store interfaces. Since better-sqlite3 is synchronous, this should be straightforward.

### Low Priority (Nice to Have)

6. **Document `IAgent`, `ITimelineSource`, and `InAppNotificationRouter`** in `docs/abstractions.md`.

7. **Extract `buildWhereClause` helper** to `src/core/stores/utils.ts` to eliminate repeated SQL-building pattern across store implementations.

8. **Consider `BaseTelegramBotService`** to deduplicate pending-action lifecycle code between `TelegramBotService` and `TelegramAgentBotService`.
