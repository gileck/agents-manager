# Architecture Audit Report — 2026-03-25

## Summary

- Scopes checked: abstractions, layers, registration, docs
- Total checks run: 12
- Passed: 7
- Failed: 3
- Warnings: 2

| Check | Scope | Result |
|-------|-------|--------|
| 1. No direct implementation imports | abstractions | **FAIL** |
| 2. Constructor parameter types use interfaces | abstractions | **FAIL** |
| 3. No business logic in transport layers | layers | PASS |
| 4. No SQLite/DB imports outside stores | layers | PASS |
| 5. No engine-specific code in agents | abstractions | PASS |
| 6. No platform-specific code in services | layers | PASS |
| 7. Renderer does not import core | layers | **WARN** |
| 8. Interface completeness | abstractions | PASS |
| 9. Registration points are pure wiring | registration | PASS |
| 10. Registration points are documented | registration | PASS |
| 11. Documentation accuracy | docs | **FAIL** |
| 12. No code duplication across implementations | abstractions | **WARN** |

---

## Abstraction Integrity

### 1. AgentLib — Agent Logic vs AI Engine

- [PASS] Check 1 — No direct implementation imports
- [PASS] Check 2 — Constructor types use interfaces
- [PASS] Check 5 — No engine-specific code in agents
- [WARN] Check 12 — Some duplication across engine implementations (see Code Duplication section)

### 2. PromptBuilder — Prompt Construction vs Agent Execution

- [PASS] Check 1 — No direct implementation imports
- [FAIL] Check 11 — 3 undocumented implementations (PostMortemReviewerPromptBuilder, TriagerPromptBuilder, UxDesignerPromptBuilder)
- [WARN] Check 12 — Mode dispatch pattern duplicated across builders

### 3. Data Stores — Domain Logic vs Persistence

- [PASS] Check 1 — No direct implementation imports (all sqlite-* imports only in setup.ts)
- [PASS] Check 4 — No SQLite imports outside stores and infrastructure
- [FAIL] Check 11 — 2 undocumented store pairs (ITaskDocStore, ITransactionRunner)

### 4. NotificationRouter — Dispatch vs Channel

- [FAIL] Check 1 — `src/core/services/telegram-bot-manager.ts:14` imports `TelegramNotificationRouter` directly
  - Line 88: `new TelegramNotificationRouter(bot, notificationChatId ?? chatId)`
  - **Fix:** Inject a factory function `(bot, chatId) => INotificationRouter` instead of importing the concrete class. Or move this instantiation to `setup.ts` and pass the router in as a dependency.

### 5. AgentService / SchedulerSupervisor

- [FAIL] Check 2 — `src/core/services/scheduler-supervisor.ts:10` uses concrete `ScheduledAgentService` type
  - Constructor parameter `scheduledAgentService: ScheduledAgentService` should use an interface
  - **Fix:** Create `IScheduledAgentService` interface in `src/core/interfaces/` and use it as the parameter type

### 6. GitOps / ScmPlatform / WorktreeManager

- [PASS] Check 1 — No direct implementation imports outside setup.ts
- [PASS] Check 6 — No platform-specific code in services

### 7. WorkflowService — Business Logic vs Client Transport

- [PASS] Check 3 — All IPC handlers, CLI commands, daemon routes, and web shim are thin wrappers

### 8. IAgent, AgentFramework, PipelineEngine, etc.

- [PASS] All remaining abstractions pass Checks 1, 2, 5, 8

---

## Layer Boundary Violations

### Check 3: No business logic in transport layers — PASS

All 18 IPC handlers, 15 CLI commands, 25 daemon routes, and the web API shim are thin wrappers. Each extracts parameters, delegates to WorkflowService or a store, and returns the result. No business logic found.

### Check 4: No SQLite/DB imports outside stores — PASS

All `better-sqlite3` imports, `.prepare()` calls, and raw SQL strings are confined to:
- `src/core/stores/` (24 SQLite store implementations)
- `src/core/db.ts` (DB initialization)
- `src/core/schema.ts` (baseline schema)
- `src/core/migrations.ts` (incremental migrations)
- `src/core/providers/setup.ts` (composition root — Database type only)

### Check 6: No platform-specific code in services — PASS

No `execSync`/`spawn` with git/gh found outside the dedicated implementations (`local-git-ops.ts`, `github-scm-platform.ts`, `local-worktree-manager.ts`). Services properly use `IGitOps` and `IScmPlatform` interfaces.

### Check 7: Renderer does not import core — WARN

**1 type-only import from core in renderer:**

- `src/renderer/components/task-detail/ImplementationReviewSection.tsx:3`
  ```typescript
  import type { ReviewComment } from '../../../core/agents/reviewer-prompt-builder';
  ```
  - **Severity:** WARN (type-only, erased at runtime — no runtime dependency)
  - **Fix:** Move `ReviewComment` type to `src/shared/types.ts` and update the import

---

## Registration Point Issues

### Check 9: Registration points are pure wiring — PASS

All three documented registration points verified as pure wiring:

1. **`src/core/providers/setup.ts`** — 12 private initialization functions, all pure instantiation and dependency injection. No business logic, no service method calls, no data queries beyond initialization.
2. **`src/core/services/agent-lib-registry.ts`** — Simple Map-based lookup. Methods are either registration (`libs.set()`) or query (`libs.get()`).
3. **`src/core/agents/agent-builders.ts`** — Pure declarative map of agent type strings to builder class constructors.

### Check 10: Registration points are documented — PASS

All concrete implementation imports trace back to documented registration points:
- All 23 SQLite store classes: only in `setup.ts`
- All 4 AgentLib implementations: only in `setup.ts`
- GitOps, ScmPlatform, WorktreeManager: only in `setup.ts` factory lambdas
- Prompt builders: only in `agent-builders.ts`
- Notification routers: in `setup.ts` + `telegram-bot-manager.ts` (the latter is the Check 1 violation)

---

## Documentation Gaps (Check 11)

### FAIL: Undocumented PromptBuilder implementations

3 prompt builders exist but are not listed in `docs/abstractions.md` Section 2:

| Builder | File |
|---------|------|
| `PostMortemReviewerPromptBuilder` | `src/core/agents/post-mortem-reviewer-prompt-builder.ts` |
| `TriagerPromptBuilder` | `src/core/agents/triager-prompt-builder.ts` |
| `UxDesignerPromptBuilder` | `src/core/agents/ux-designer-prompt-builder.ts` |

**Fix:** Add these to the "Implementations" list in abstraction #2.

### FAIL: Undocumented Data Store pairs

2 store interface/implementation pairs exist but are not in the store table in Section 5:

| Interface | Implementation |
|-----------|---------------|
| `ITaskDocStore` | `sqlite-task-doc-store.ts` |
| `ITransactionRunner` | `sqlite-transaction-runner.ts` |

**Fix:** Add these rows to the data stores table in abstraction #5.

### WARN: Settings store naming convention

`ISettingsStore` implementation is `settings-store.ts` rather than `sqlite-settings-store.ts`, breaking the naming convention of all other stores.

**Fix (optional):** Rename to `sqlite-settings-store.ts` for consistency, or document the exception.

### All interface/implementation file paths verified

All 19 abstractions have correct file paths. All documented implementations exist. All registration points exist and function as described.

---

## Code Duplication (Check 12)

### WARN: AgentLib error handling duplication (Medium)

**Files:** `claude-code-lib.ts:438-474`, `cursor-agent-lib.ts:183`, `codex-cli-lib.ts:467-473`

All engine implementations follow the same error handling structure after `runEngine()` fails:
1. Check `state.stoppedReason === 'timeout'` → set `killReason`
2. Else check `signal.aborted` → set `killReason`
3. Else call `buildDiagnostics()` to format error context
4. Same logging pattern with stderr, stack, token counts

**Suggestion:** Extract to `BaseAgentLib.handleEngineError()` helper method (~50 lines saved).

### WARN: PromptBuilder mode dispatch duplication (Medium)

**Files:** All 6+ prompt builders in `src/core/agents/`

All builders duplicate the same mode-dispatch pattern:
```typescript
if (mode === 'revision' && revisionReason === 'changes_requested') { ... }
else if (mode === 'revision' && revisionReason === 'info_provided') { ... }
else { /* new mode */ }
```

Also repeated: task description formatting, session-aware preamble logic, feedback formatting calls, json_schema output wrapping.

**Suggestion:** Extract `buildModeAwarePrompt()` helper to `BaseAgentPromptBuilder` (~200 lines saved across builders).

### INFO: Timeline sources thin wrappers (Low)

**Files:** All 8 files in `src/core/services/timeline/sources/`

Each source is ~12 lines delegating to a single store method. Could be replaced with a factory or generic wrapper, but the current approach is clear and not harmful.

### INFO: Codex image handling (Low)

**Files:** `codex-cli-lib.ts:550-556`, `codex-app-server-lib.ts:774`

Both Codex engines call `writeImagesToTempDir()` with identical patterns. Already using a shared utility, so the remaining duplication is minimal.

---

## Recommendations

### Priority 1 — Abstraction Violations (fix to maintain boundary integrity)

1. **telegram-bot-manager.ts** (Check 1): Inject a notification router factory instead of importing `TelegramNotificationRouter` directly. This keeps the composition root as the only place that knows about concrete notification implementations.

2. **scheduler-supervisor.ts** (Check 2): Create `IScheduledAgentService` interface and use it as the constructor parameter type.

### Priority 2 — Documentation (fix to keep docs accurate)

3. **abstractions.md Section 2**: Add PostMortemReviewerPromptBuilder, TriagerPromptBuilder, UxDesignerPromptBuilder to the PromptBuilder implementations list.

4. **abstractions.md Section 5**: Add ITaskDocStore and ITransactionRunner to the data stores table.

### Priority 3 — Code Quality (fix to reduce maintenance burden)

5. **ImplementationReviewSection.tsx** (Check 7): Move `ReviewComment` type to `src/shared/types.ts`.

6. **BaseAgentLib** (Check 12): Extract `handleEngineError()` helper to reduce error handling duplication across engine implementations.

7. **BaseAgentPromptBuilder** (Check 12): Extract `buildModeAwarePrompt()` helper to reduce mode dispatch duplication.
